/**
 * Content script for Mode A: paste-intercept on AI sites.
 * Runs on chatgpt.com, claude.ai, gemini.google.com.
 *
 * Listens for paste events, scans pasted text with L1, and if PII
 * is found, replaces the paste with sanitized text + shows a toast.
 */

import { scanL1, Detection } from '../scanner';
import { tokenize } from '../tokenizer';
import { renderSanitizerToast } from '../ui/toast';
import explanations from '../knowledge/explanations.json';

interface FieldSnapshot {
  value: string;
  start: number;
  end: number;
}

// Cache mode synchronously so the paste handler can decide whether to intercept WITHOUT an
// await (chrome.storage is async, but preventDefault must run during the event's synchronous
// phase). Defaults to the install default (Mode A on).
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

// Mode A paste-intercept.
//
// Detection (L1) and the replacement run SYNCHRONOUSLY inside the paste event: the native
// paste is cancelled and the sanitized text inserted before control yields, so there is no
// async gap in which raw PII could land, the paste could be dropped, or concurrent typing
// could be clobbered. We only cancel the native paste when L1 actually finds PII; clean text
// and Mode-A-off pastes proceed natively (preserving rich content).
//
// Deep Scan (L2) is intentionally NOT applied here: mutating a third-party rich contentEditable
// editor asynchronously is unreliable and risks corrupting the de-tokenization map. L2 runs in
// the async-safe flows instead — the popup scanner and the Ctrl+Shift+S shortcut.
document.addEventListener('paste', (e: ClipboardEvent) => {
  // Page-synthesized paste events could poison the browser-wide mapping store
  // with attacker-chosen clipboardData — only act on real user gestures.
  if (!e.isTrusted) return;
  if (modeCache !== 'A') return; // Mode A off → native paste untouched

  const text = e.clipboardData?.getData('text/plain');
  if (!text || text.trim().length === 0) return;

  const target = e.target as HTMLElement;
  const field =
    target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
  if (!field && !target?.isContentEditable) return; // not an editable target we handle

  const detections = scanL1(text);
  if (detections.length === 0) return; // clean text → native paste untouched

  // Orphaned script (extension updated while this tab stayed open): mappings could
  // never be persisted, so don't mint unrestorable placeholders — native paste through.
  if (!extensionAlive()) return;

  // PII found — snapshot the field, cancel the native paste, and insert the sanitized text.
  // selectionStart/End are null on input types without a selection API (email,
  // number — WHATWG limits it to text/search/url/tel/password); fall back to
  // end-of-value so existing content is preserved rather than spliced at 0.
  const snap: FieldSnapshot | null = field
    ? {
        value: field.value,
        start: field.selectionStart ?? field.value.length,
        end: field.selectionEnd ?? field.value.length,
      }
    : null;
  e.preventDefault();

  const sanitized = tokenize(text, detections, { source: 'paste', site: location.hostname });
  if (field && snap) {
    field.value = snap.value.slice(0, snap.start) + sanitized + snap.value.slice(snap.end);
    try {
      field.selectionStart = field.selectionEnd = snap.start + sanitized.length;
    } catch {
      // WRITING selection throws InvalidStateError on selection-less input
      // types (reading just returns null). Swallow it: the caret position is
      // cosmetic, but an uncaught throw here would skip the input event and
      // the toast — the user pasted PII and got zero feedback (found live on
      // claude.ai's email login field).
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.isContentEditable) {
    document.execCommand('insertText', false, sanitized);
  }

  showToast(detections);
}, true);

function showToast(detections: Detection[]) {
  renderSanitizerToast({
    headline: `Protected ${detections.length} item${detections.length > 1 ? 's' : ''} in your paste`,
    items: detections.map(d => ({
      label:
        (explanations as Record<string, { title: string }>)[d.explanationKey]?.title || d.type,
      severity: d.severity,
    })),
    // Only promise what the product can do: the popup opens from the toolbar
    // icon, and the Restore tab is where placeholders become real values again.
    footer:
      'Placeholders were inserted — paste the AI’s reply into step 3 (Restore) in the extension popup to bring real values back.',
  });
}
