/**
 * Content script for Mode B: copy-intercept on ALL sites.
 * Listens for copy events, scans copied text with L1, and if PII
 * is found, replaces clipboard content with sanitized text + notifies.
 */

import { scanL1, Detection } from '../scanner';
import { tokenize } from '../tokenizer';
import { renderSanitizerToast } from '../ui/toast';
import explanations from '../knowledge/explanations.json';

// Cache mode synchronously so the copy handler can decide whether to intercept WITHOUT an
// await: preventDefault and clipboardData.setData only work during the event's synchronous
// dispatch phase — an awaited chrome.storage read resolves after the native copy has already
// committed the raw selection to the clipboard. Defaults to 'A' (Mode B off) — fail-safe.
let modeCache = 'A';
chrome.storage.local.get('mode', (r) => {
  modeCache = r.mode || 'A';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mode) modeCache = changes.mode.newValue || 'A';
});

/** False once the extension is updated/reloaded and this script is orphaned. */
function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// Mode C keyboard shortcut is handled by the service worker.
// Content script only handles Mode B copy-intercept.

// Armed by the toast's Undo button: the user just told us THIS rewrite was
// wrong, so re-copying the SAME text must pass through instead of being
// rewritten again. Scoped to the exact undone selection (not tab-global) so
// undoing one false positive can't silently disable protection for unrelated
// sensitive copies in the same tab. Per content-script instance; copy-intercept
// is not registered all_frames, so this matches the interception scope exactly.
const SNOOZE_MS = 30_000;
let snoozedSelection: string | null = null;
let snoozeUntil = 0;

document.addEventListener('copy', (e: ClipboardEvent) => {
  // Page-synthesized copy events (dispatchEvent/execCommand loops) could poison the
  // browser-wide mapping store with attacker-chosen values — only act on real gestures.
  if (!e.isTrusted) return;
  if (modeCache !== 'B') return;

  // Get the selected text
  const selection = window.getSelection()?.toString();
  if (!selection || selection.trim().length === 0) return;

  // Just-undone text passes through untouched for a short window (only this
  // exact selection — unrelated copies are still scanned).
  if (snoozedSelection !== null && selection === snoozedSelection && Date.now() < snoozeUntil) {
    return;
  }

  const detections = scanL1(selection);
  if (detections.length === 0) return; // Clean text — let copy through normally

  // Orphaned script (extension updated while this page stayed open): don't mint
  // placeholders whose mappings can never be persisted — let the native copy through.
  if (!extensionAlive()) return;

  // PII found — replace clipboard with sanitized text. Stop propagation so
  // page copy handlers later in this dispatch (e.g. attribution-append
  // scripts) can't overwrite text/plain with the raw selection. Residual
  // limit: page capture listeners registered before this script still run
  // first, and the DataTransfer can't be verified after dispatch.
  e.preventDefault();
  e.stopImmediatePropagation();
  e.stopPropagation();
  const sanitized = tokenize(selection, detections, { source: 'copy', site: location.hostname });
  e.clipboardData?.setData('text/plain', sanitized);

  // Notify via the extension badge (count shown on the toolbar icon)
  chrome.runtime.sendMessage({
    type: 'copy-sanitized',
    count: detections.length,
    highCount: detections.filter(d => d.severity === 'high').length,
    mediumCount: detections.filter(d => d.severity === 'medium').length,
  });

  // A silent clipboard rewrite is invisible until the user pastes somewhere
  // unexpected — say what happened and offer a way out. Undo puts the raw
  // selection back on the clipboard and snoozes re-interception in this tab.
  renderSanitizerToast(
    {
      headline: `Protected ${detections.length} item${detections.length > 1 ? 's' : ''} in your copy`,
      items: detections.map((d: Detection) => ({
        label:
          (explanations as Record<string, { title: string }>)[d.explanationKey]?.title || d.type,
        severity: d.severity,
      })),
      footer:
        'Ctrl+V pastes the safe version. Paste the AI’s reply into step 3 (Restore) in the extension popup to bring real values back.',
      undoText: selection,
    },
    {
      onUndone: () => {
        // Let re-copying this exact text through for a short window, and clear
        // the "N caught" toolbar badge — the clipboard now holds the original,
        // so the badge would otherwise assert protection that was just reverted.
        snoozedSelection = selection;
        snoozeUntil = Date.now() + SNOOZE_MS;
        chrome.runtime.sendMessage({ type: 'copy-undone' });
      },
    }
  );
}, true);
