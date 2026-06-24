/**
 * Content script for Mode A: paste-intercept on AI sites.
 * Runs on chatgpt.com, claude.ai, gemini.google.com.
 *
 * Listens for paste events, scans pasted text with L1, and if PII
 * is found, replaces the paste with sanitized text + shows a toast.
 */

import { scanL1, Detection } from '../scanner';
import { tokenize } from '../tokenizer';
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
  if (modeCache !== 'A') return; // Mode A off → native paste untouched

  const text = e.clipboardData?.getData('text/plain');
  if (!text || text.trim().length === 0) return;

  const target = e.target as HTMLElement;
  const field =
    target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
  if (!field && !target?.isContentEditable) return; // not an editable target we handle

  const detections = scanL1(text);
  if (detections.length === 0) return; // clean text → native paste untouched

  // PII found — snapshot the field, cancel the native paste, and insert the sanitized text.
  const snap: FieldSnapshot | null = field
    ? { value: field.value, start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 }
    : null;
  e.preventDefault();

  const sanitized = tokenize(text, detections);
  if (field && snap) {
    field.value = snap.value.slice(0, snap.start) + sanitized + snap.value.slice(snap.end);
    field.selectionStart = field.selectionEnd = snap.start + sanitized.length;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.isContentEditable) {
    document.execCommand('insertText', false, sanitized);
  }

  showToast(detections);
}, true);

/** Escape text before interpolating into innerHTML — page-controlled values are untrusted. */
function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function showToast(detections: Detection[]) {
  // Remove existing toast if any
  document.querySelector('.prompt-sanitizer-toast')?.remove();

  const highCount = detections.filter(d => d.severity === 'high').length;
  const mediumCount = detections.filter(d => d.severity === 'medium').length;

  const toast = document.createElement('div');
  toast.className = 'prompt-sanitizer-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  let detailsHtml = '';
  // Show first 2 detections inline
  const preview = detections.slice(0, 2);
  for (const d of preview) {
    const exp = (explanations as Record<string, { title: string }>)[d.explanationKey];
    const label = exp?.title || d.type;
    detailsHtml += `
      <div class="prompt-sanitizer-toast-detail-item">
        <span class="prompt-sanitizer-toast-dot ${d.severity}"></span>
        ${escapeHtml(label)}: <code>${escapeHtml(d.value.length > 20 ? d.value.slice(0, 17) + '...' : d.value)}</code>
      </div>
    `;
  }
  if (detections.length > 2) {
    detailsHtml += `<div class="prompt-sanitizer-toast-detail-item">+${detections.length - 2} more</div>`;
  }

  toast.innerHTML = `
    <div class="prompt-sanitizer-toast-header">
      <span class="prompt-sanitizer-toast-shield">&#x1f6e1;</span>
      ${detections.length} item${detections.length > 1 ? 's' : ''} sanitized
    </div>
    <div class="prompt-sanitizer-toast-details">
      ${detailsHtml}
    </div>
    <div class="prompt-sanitizer-toast-action">Click to review in extension popup</div>
  `;

  toast.addEventListener('click', () => {
    // Open the extension popup (best effort — may not work in all browsers)
    chrome.runtime.sendMessage({ type: 'open-popup' });
    toast.remove();
  });

  document.body.appendChild(toast);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    toast.classList.add('fading');
    setTimeout(() => toast.remove(), 300);
  }, 8000);
}
