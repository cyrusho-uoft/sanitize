/**
 * Content script for Mode A: paste-intercept on AI sites.
 * Runs on chatgpt.com, claude.ai, gemini.google.com.
 *
 * Listens for paste events, scans pasted text with L1, and if PII
 * is found, replaces the paste with sanitized text + shows a toast.
 */

import { scanL1, Detection } from '../scanner';
import { tokenize, PLACEHOLDER_RE } from '../tokenizer';
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

  // PII found — snapshot the field, cancel the native paste, and insert the
  // sanitized text. selectionStart/End read null on input types without a
  // selection API (email, number — WHATWG limits it to
  // text/search/url/tel/password); fall back to end-of-value.
  const snap: FieldSnapshot | null = field
    ? {
        value: field.value,
        start: field.selectionStart ?? field.value.length,
        end: field.selectionEnd ?? field.value.length,
      }
    : null;
  e.preventDefault();

  const sanitized = tokenize(text, detections, { source: 'paste', site: location.hostname });
  // detections.length > 0 ⇒ sanitized contains ≥1 placeholder, and
  // placeholders never span lines, so the marker survives the newline
  // stripping single-line inputs apply to inserted text.
  const marker = sanitized.match(PLACEHOLDER_RE)?.[0] ?? sanitized;
  const landed = () => ((field ? field.value : target.textContent) || '').includes(marker);

  // Insert via execCommand first for BOTH plain fields and contentEditable:
  // it edits at the browser's REAL caret/selection (email/number fields read
  // selectionStart as null yet still show a visual selection — splicing turns
  // a replace-selection paste into an append), fires a native input event
  // that React's value tracker accepts (a synthetic Event dispatched after a
  // direct .value write is deduped, so the app state never learns about the
  // sanitized text), and preserves the undo stack. Its return value is
  // unreliable (true even when type=number rejects the text), so success is
  // judged by content: did a placeholder land?
  let inserted = false;
  try {
    document.execCommand('insertText', false, sanitized);
    inserted = landed();
  } catch {
    inserted = false;
  }

  if (!inserted && field && snap && field.value === snap.value) {
    // Fallback splice for fields where execCommand didn't take. Write through
    // the prototype setter so React's tracker registers the change when the
    // input event below arrives. (Skipped when execCommand already altered
    // the field — splicing on top would double-insert.)
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    const setValue = (v: string) => {
      if (desc?.set) desc.set.call(field, v);
      else field.value = v;
    };
    setValue(snap.value.slice(0, snap.start) + sanitized + snap.value.slice(snap.end));
    inserted = landed();
    if (inserted) {
      if (field.selectionStart !== null) {
        // Selection-less types throw on selection WRITES (reads return null),
        // so the support check is stated directly instead of a catch.
        field.selectionStart = field.selectionEnd = snap.start + sanitized.length;
      }
    } else {
      // Value sanitization rejected the placeholder text (e.g. type=number
      // coerces the whole value to ''): restore the original content instead
      // of leaving the field wiped. The PII paste stays blocked either way.
      setValue(snap.value);
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  showToast(detections, inserted);
}, true);

function showToast(detections: Detection[], inserted: boolean) {
  const n = detections.length;
  renderSanitizerToast({
    headline: inserted
      ? `Protected ${n} item${n > 1 ? 's' : ''} in your paste`
      : `Blocked a paste with ${n} sensitive item${n > 1 ? 's' : ''}`,
    items: detections.map(d => ({
      label:
        (explanations as Record<string, { title: string }>)[d.explanationKey]?.title || d.type,
      severity: d.severity,
    })),
    // Only promise what actually happened: placeholders either landed in the
    // field, or the field rejected them (e.g. type=number) and the paste was
    // simply blocked — claiming insertion then would be false feedback.
    footer: inserted
      ? 'Placeholders were inserted — paste the AI’s reply into step 3 (Restore) in the extension popup to bring real values back.'
      : 'This field can’t hold placeholders, so nothing was inserted. Your clipboard still has the original text.',
  });
}
