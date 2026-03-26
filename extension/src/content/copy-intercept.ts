/**
 * Content script for Mode B: copy-intercept on ALL sites.
 * Listens for copy events, scans copied text with L1, and if PII
 * is found, replaces clipboard content with sanitized text + notifies.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

async function isModeBEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('mode');
    return result.mode === 'B';
  } catch {
    return false;
  }
}

document.addEventListener('copy', async (e: ClipboardEvent) => {
  if (!(await isModeBEnabled())) return;

  // Get the selected text
  const selection = window.getSelection()?.toString();
  if (!selection || selection.trim().length === 0) return;

  const detections = scanL1(selection);
  if (detections.length === 0) return; // Clean text — let copy through normally

  // PII found — replace clipboard with sanitized text
  e.preventDefault();
  const sanitized = tokenize(selection, detections);
  e.clipboardData?.setData('text/plain', sanitized);

  // Notify via extension badge + system notification
  chrome.runtime.sendMessage({
    type: 'copy-sanitized',
    count: detections.length,
    highCount: detections.filter(d => d.severity === 'high').length,
    mediumCount: detections.filter(d => d.severity === 'medium').length,
  });
}, true);
