/**
 * Content script for Mode A: paste-intercept on AI sites.
 * Runs on chatgpt.com, claude.ai, gemini.google.com.
 *
 * Listens for paste events, scans pasted text with L1, and if PII
 * is found, replaces the paste with sanitized text + shows a toast.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';
import explanations from '../knowledge/explanations.json';

// Check if Mode A is enabled (default: true)
async function isModeAEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('mode');
    return !result.mode || result.mode === 'A';
  } catch {
    return true;
  }
}

// Listen for paste events on the page
document.addEventListener('paste', async (e: ClipboardEvent) => {
  if (!(await isModeAEnabled())) return;

  const text = e.clipboardData?.getData('text/plain');
  if (!text || text.trim().length === 0) return;

  const detections = scanL1(text);
  if (detections.length === 0) return; // Clean text — let paste through normally

  // PII found — sanitize and replace
  e.preventDefault();

  const sanitized = tokenize(text, detections);

  // Insert sanitized text into the active element
  const target = e.target as HTMLElement;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    target.value = before + sanitized + after;
    target.selectionStart = target.selectionEnd = start + sanitized.length;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (target.isContentEditable) {
    document.execCommand('insertText', false, sanitized);
  }

  // Show toast
  showToast(detections);
}, true);

function showToast(detections: typeof import('../scanner').Detection extends (infer T)[] ? T[] : never) {
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
        ${label}: <code>${d.value.length > 20 ? d.value.slice(0, 17) + '...' : d.value}</code>
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
