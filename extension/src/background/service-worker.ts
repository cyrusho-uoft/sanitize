/**
 * Background service worker.
 * Handles keyboard shortcuts and extension badge updates.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

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
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'Prompt Sanitizer',
        message: 'Select some text first, then press Ctrl+Shift+S.',
      });
      return;
    }

    const detections = scanL1(text);
    if (detections.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'Prompt Sanitizer',
        message: 'No sensitive information found in selection.',
      });
      return;
    }

    const sanitized = tokenize(text, detections);

    // Write sanitized text to clipboard via the active tab
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (s: string) => navigator.clipboard.writeText(s),
      args: [sanitized],
    });

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'Prompt Sanitizer',
      message: `${detections.length} item${detections.length > 1 ? 's' : ''} sanitized and copied to clipboard.`,
    });
  } catch (err) {
    console.error('Sanitize selection failed:', err);
  }
});

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
