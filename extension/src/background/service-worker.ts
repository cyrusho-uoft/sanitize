/**
 * Background service worker.
 * Handles keyboard shortcuts and extension badge updates.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

// Handle keyboard shortcut (Ctrl+Shift+S) for Mode C
// Clipboard API isn't available in service workers, so we delegate to the active tab
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'sanitize-clipboard') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Inject a one-shot script into the active tab to read + sanitize clipboard
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: sanitizeClipboardInPage,
    });
  } catch (err) {
    console.error('Sanitize clipboard shortcut failed:', err);
  }
});

// This function runs in the page context (injected via executeScript)
// It must be self-contained — no imports from the extension bundle
function sanitizeClipboardInPage() {
  // Send message to the content script (which has the scanner bundled)
  chrome.runtime.sendMessage({ type: 'sanitize-clipboard-request' });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === 'open-popup') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#DC3545' });
  }

  if (message.type === 'show-notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: message.title,
      message: message.message,
    });
  }

  if (message.type === 'copy-sanitized') {
    // Mode B: show badge + notification when copy was sanitized
    chrome.action.setBadgeText({ text: String(message.count) });
    chrome.action.setBadgeBackgroundColor({ color: '#DC3545' });

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'Prompt Sanitizer',
      message: `${message.count} item${message.count > 1 ? 's' : ''} sanitized in your clipboard.`,
    });

    // Clear badge after 5 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 5000);
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
