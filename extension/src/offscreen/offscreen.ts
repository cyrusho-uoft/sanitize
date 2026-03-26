// Offscreen document — has full clipboard access as an extension page.
// The service worker creates this temporarily to read/write clipboard.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'read-clipboard') {
    navigator.clipboard.readText()
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ text: '', error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'write-clipboard') {
    navigator.clipboard.writeText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
