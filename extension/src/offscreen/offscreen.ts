// Offscreen document — reads/writes clipboard via execCommand.
// navigator.clipboard requires focus; execCommand works without it
// in extension pages with clipboardRead/clipboardWrite permissions.

const textarea = document.getElementById('t') as HTMLTextAreaElement;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'read-clipboard') {
    textarea.value = '';
    textarea.focus();
    document.execCommand('paste');
    sendResponse({ text: textarea.value });
    return false;
  }

  if (message.type === 'write-clipboard') {
    textarea.value = message.text;
    textarea.select();
    document.execCommand('copy');
    sendResponse({ ok: true });
    return false;
  }
});
