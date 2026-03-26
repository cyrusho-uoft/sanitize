/**
 * Background service worker.
 * Handles keyboard shortcuts and extension badge updates.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

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
      return;
    }

    const detections = scanL1(text);
    if (detections.length === 0) {
      showBadge('\u2713', '#28A745', 3000);
      return;
    }

    const sanitized = tokenize(text, detections);

    // Write sanitized text to clipboard via the active tab
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (s: string) => navigator.clipboard.writeText(s),
      args: [sanitized],
    });

    showBadge(String(detections.length), '#DC3545', 4000);

    // Show toast on the active tab
    const toastData = detections.map(d => ({ type: d.type, value: d.value, severity: d.severity }));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showSanitizerToast,
      args: [toastData],
    });
  } catch (err) {
    console.error('Sanitize selection failed:', err);
  }
});

// Injected into the active tab to show a toast notification
function showSanitizerToast(detections: { type: string; value: string; severity: string }[]) {
  // Remove existing toast
  document.querySelector('.ps-toast')?.remove();

  // Inject CSS if not already present
  if (!document.querySelector('#ps-toast-style')) {
    const style = document.createElement('style');
    style.id = 'ps-toast-style';
    style.textContent = `
      .ps-toast {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        background: #002A5C; color: white; border-radius: 8px;
        padding: 12px 16px; font-family: system-ui, sans-serif; font-size: 13px;
        line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 360px; animation: psSlide 0.3s ease-out;
      }
      .ps-toast.ps-fading { opacity: 0; transition: opacity 0.3s; }
      @keyframes psSlide {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .ps-toast-header { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px; }
      .ps-toast-items { font-size: 11px; opacity: 0.85; }
      .ps-toast-item { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
      .ps-toast-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      .ps-toast-dot.high { background: #DC3545; }
      .ps-toast-dot.medium { background: #FFC107; }
      .ps-toast-footer { margin-top: 8px; font-size: 11px; opacity: 0.6; }
    `;
    document.head.appendChild(style);
  }

  const TYPE_LABELS: Record<string, string> = {
    sin: 'Social Insurance Number', student_number: 'Student Number',
    health_card: 'Health Card', credit_card: 'Credit Card',
    email: 'Email Address', phone: 'Phone Number',
    utorid: 'UTORid', username: 'Username', employee_id: 'Employee ID',
  };

  const toast = document.createElement('div');
  toast.className = 'ps-toast';
  toast.setAttribute('role', 'alert');

  let itemsHtml = '';
  const preview = detections.slice(0, 3);
  for (const d of preview) {
    const label = TYPE_LABELS[d.type] || d.type;
    const val = d.value.length > 20 ? d.value.slice(0, 17) + '...' : d.value;
    itemsHtml += `<div class="ps-toast-item"><span class="ps-toast-dot ${d.severity}"></span>${label}: <code>${val}</code></div>`;
  }
  if (detections.length > 3) {
    itemsHtml += `<div class="ps-toast-item">+${detections.length - 3} more</div>`;
  }

  toast.innerHTML = `
    <div class="ps-toast-header">&#x1f6e1; ${detections.length} item${detections.length > 1 ? 's' : ''} sanitized &amp; copied</div>
    <div class="ps-toast-items">${itemsHtml}</div>
    <div class="ps-toast-footer">Ctrl+V to paste sanitized text</div>
  `;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('ps-fading');
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'open-popup') {
    showBadge('!', '#DC3545', 5000);
  }

  if (message.type === 'copy-sanitized') {
    showBadge(String(message.count), '#DC3545', 5000);
  }
});

// Clear badge when popup opens
chrome.action.onClicked.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});

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
