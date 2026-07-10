/**
 * Content script for Mode B: copy-intercept on ALL sites.
 * Listens for copy events, scans copied text with L1, and if PII
 * is found, replaces clipboard content with sanitized text + notifies.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

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

document.addEventListener('copy', (e: ClipboardEvent) => {
  // Page-synthesized copy events (dispatchEvent/execCommand loops) could poison the
  // browser-wide mapping store with attacker-chosen values — only act on real gestures.
  if (!e.isTrusted) return;
  if (modeCache !== 'B') return;

  // Get the selected text
  const selection = window.getSelection()?.toString();
  if (!selection || selection.trim().length === 0) return;

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
  const sanitized = tokenize(selection, detections);
  e.clipboardData?.setData('text/plain', sanitized);

  // Notify via the extension badge (count shown on the toolbar icon)
  chrome.runtime.sendMessage({
    type: 'copy-sanitized',
    count: detections.length,
    highCount: detections.filter(d => d.severity === 'high').length,
    mediumCount: detections.filter(d => d.severity === 'medium').length,
  });
}, true);
