/**
 * Background service worker.
 * Handles keyboard shortcuts and extension badge updates.
 */

import { scanL1, scanL2, mergeDetections, Detection } from '../scanner';
import { tokenize } from '../tokenizer';
import { PERSIST_MESSAGE_TYPE, writeBatchDirect, MappingBatch } from '../tokenizer/mapping-store';
import { loadDeepScanSettings } from '../settings/deep-scan';
import { renderSanitizerToast, SanitizerToastPayload } from '../ui/toast';
import explanations from '../knowledge/explanations.json';

/** Resolve the user-facing label for a detection (shared toast shows labels, never values). */
function detectionLabel(d: Detection): string {
  return (
    (explanations as Record<string, { title: string }>)[d.explanationKey]?.title || d.type
  );
}

/** Inject the shared toast into a tab. Best effort — restricted pages will reject. */
async function showToastInTab(tabId: number, payload: SanitizerToastPayload): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    // The shared renderer is fully self-contained, so it survives the
    // executeScript serialization; chrome-types declares func as () => void.
    func: renderSanitizerToast as unknown as () => void,
    args: [payload],
  });
}

/** Show a badge on the extension icon that auto-clears */
function showBadge(text: string, color: string, durationMs: number = 4000) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), durationMs);
}

// Handle keyboard shortcut (Ctrl+Shift+S) for Mode C
// Reads the selected text on the active page, sanitizes it, copies to clipboard
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'sanitize-clipboard') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Get selected text from the active tab
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() || '',
    });

    const text = result?.result as string;
    if (!text || text.trim().length === 0) {
      showBadge('?', '#856404', 3000);
      await showToastInTab(tab.id, {
        headline: 'Nothing selected',
        items: [],
        footer: 'Select some text first, then press Ctrl+Shift+S. Clipboard unchanged.',
      }).catch(() => {});
      return;
    }

    const l1 = scanL1(text);
    const ds = await loadDeepScanSettings();
    const detections = ds.enabled
      ? mergeDetections(l1, await scanL2(text, { url: ds.backendUrl }))
      : l1;
    // Clean or sanitized, the shortcut's contract is "the selection is now
    // on your clipboard" \u2014 verified via the success flag returned below.
    let site: string | undefined;
    try {
      site = tab.url ? new URL(tab.url).hostname : undefined;
    } catch {
      site = undefined;
    }
    const sanitized =
      detections.length === 0 ? text : tokenize(text, detections, { source: 'shortcut', site });

    // Write to the clipboard via the active tab. Chrome does not propagate
    // injected-function errors (crbug.com/1271527), so the injected function
    // catches and RETURNS a success flag — success feedback only shows when
    // that flag is true.
    // chrome-types declares `func` as () => void, so cast — args are passed at runtime.
    const [copied] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (async (s: string) => {
        try {
          await navigator.clipboard.writeText(s);
          return true;
        } catch {
          return false;
        }
      }) as unknown as () => void,
      args: [sanitized],
    });

    if (copied?.result !== true) {
      showBadge('!', '#DC3545', 4000);
      await showToastInTab(tab.id, {
        headline: 'Copy failed',
        items: [],
        footer: 'Click the page to focus it, then press the shortcut again. Clipboard unchanged.',
      }).catch(() => {});
      return;
    }

    if (detections.length === 0) {
      showBadge('✓', '#1E7E34', 3000);
      await showToastInTab(tab.id, {
        headline: 'No sensitive info found',
        items: [],
        footer: 'Copied as-is — Ctrl+V to paste.',
      }).catch(() => {});
      return;
    }

    showBadge(String(detections.length), '#DC3545', 4000);
    await showToastInTab(tab.id, {
      headline: `Protected ${detections.length} item${detections.length > 1 ? 's' : ''} — copied`,
      items: detections.map(d => ({ label: detectionLabel(d), severity: d.severity })),
      footer:
        'Ctrl+V to paste the safe copy. Paste the AI’s reply into step 3 (Restore) in the extension popup to bring real values back.',
    }).catch(() => {});
  } catch (err) {
    console.error('Sanitize selection failed:', err);
    // The user pressed the shortcut and may paste next — never fail silently.
    showBadge('!', '#DC3545', 4000);
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'copy-sanitized') {
    showBadge(String(message.count), '#DC3545', 5000);
  }

  // Token-mapping batches from content scripts — they can't write
  // chrome.storage.session themselves, so the worker lands the write and
  // acknowledges it. The async response also keeps the worker alive until
  // the write completes; on failure the sender keeps a local fallback copy.
  if (message.type === PERSIST_MESSAGE_TYPE) {
    const batch = message.batch as MappingBatch | undefined;
    if (batch && Array.isArray(batch.mappings)) {
      writeBatchDirect(batch)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('Prompt Sanitizer: failed to persist token mappings:', err);
          sendResponse({ ok: false });
        });
      return true; // async sendResponse
    }
    sendResponse({ ok: false });
    return false;
  }
  return false; // not handling asynchronously
});

// L2 deep-scan proxy: content scripts/popup can't reliably fetch cross-origin, so the
// network call runs here (the worker holds the backend host permission). Gated on the
// deepScanEnabled setting; always responds (fails open to an empty result).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'deep-scan') return; // not ours — let other listeners handle it
  (async () => {
    try {
      const ds = await loadDeepScanSettings();
      if (!ds.enabled || !message.text) {
        sendResponse({ detections: [] });
        return;
      }
      const detections = await scanL2(message.text, { url: ds.backendUrl });
      sendResponse({ detections });
    } catch {
      sendResponse({ detections: [] });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});

// NOTE: badge clearing lives in popup.ts (on DOMContentLoaded). A
// chrome.action.onClicked listener would never fire here because the
// manifest declares action.default_popup.

// Open onboarding on first install
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({
      mode: 'A',
      deepScanEnabled: false,
      onboardingComplete: false,
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
});
