/**
 * Background service worker.
 * Handles keyboard shortcuts and extension badge updates.
 */

import { scanL1 } from '../scanner';
import { tokenize } from '../tokenizer';

// Handle keyboard shortcut (Ctrl+Shift+S) for Mode C
// Uses an offscreen document to access the clipboard (MV3 pattern)
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'sanitize-clipboard') return;
  await sanitizeViaOffscreen();
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Read/write clipboard for PII sanitization',
    });
  }
}

async function sanitizeViaOffscreen() {
  try {
    await ensureOffscreen();

    // Read clipboard via offscreen document
    const { text, error } = await chrome.runtime.sendMessage({ type: 'read-clipboard' }) as { text: string; error?: string };
    if (error || !text || text.trim().length === 0) {
      if (error) console.error('Clipboard read failed:', error);
      return;
    }

    const detections = scanL1(text);
    if (detections.length === 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'Prompt Sanitizer',
        message: 'No sensitive information found in clipboard.',
      });
      return;
    }

    const sanitized = tokenize(text, detections);

    // Write sanitized text via offscreen document
    await chrome.runtime.sendMessage({ type: 'write-clipboard', text: sanitized });

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'Prompt Sanitizer',
      message: `${detections.length} item${detections.length > 1 ? 's' : ''} sanitized in clipboard.`,
    });
  } catch (err) {
    console.error('Sanitize clipboard failed:', err);
  }
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
