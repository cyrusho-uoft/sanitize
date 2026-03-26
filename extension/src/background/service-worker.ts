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
  } catch (err) {
    console.error('Sanitize selection failed:', err);
  }
});

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
