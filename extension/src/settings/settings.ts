import { DEFAULT_BACKEND_URL } from '../scanner/l2';

// Last persisted backend URL — used to restore the field if a new entry is rejected.
let lastSavedBackendUrl = DEFAULT_BACKEND_URL;

// Load current settings
chrome.storage.local.get(['mode', 'deepScanEnabled', 'backendUrl'], (result) => {
  const mode = result.mode || 'A';
  const deepScan = result.deepScanEnabled || false;
  const backendUrl = result.backendUrl || DEFAULT_BACKEND_URL;
  lastSavedBackendUrl = backendUrl;

  // Set mode radio
  const radio = document.querySelector(`input[name="mode"][value="${mode}"]`) as HTMLInputElement;
  if (radio) {
    radio.checked = true;
    radio.closest('.mode-option')?.classList.add('selected');
  }

  // Set deep scan toggle + backend URL
  (document.getElementById('deep-scan-toggle') as HTMLInputElement).checked = deepScan;
  (document.getElementById('backend-url') as HTMLInputElement).value = backendUrl;
});

// Mode selection
document.querySelectorAll('.mode-option').forEach(option => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');
    const radio = option.querySelector('input[type="radio"]') as HTMLInputElement;
    if (radio) {
      radio.checked = true;
      save({ mode: radio.value });
    }
  });
});

// Deep scan toggle
document.getElementById('deep-scan-toggle')?.addEventListener('change', (e) => {
  save({ deepScanEnabled: (e.target as HTMLInputElement).checked });
});

// Backend URL (save on change/blur; empty resets to default).
// Non-localhost origins aren't in the manifest's static host_permissions, so request the
// host permission at runtime (this 'change' is a user gesture). Without it the service
// worker's fetch would be CORS-blocked and Deep Scan would silently return nothing.
document.getElementById('backend-url')?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const url = input.value.trim().replace(/\/+$/, '') || DEFAULT_BACKEND_URL;
  input.value = url;

  let originPattern: string | null = null;
  try {
    originPattern = new URL(url).origin + '/*';
  } catch {
    input.value = lastSavedBackendUrl; // restore — don't leave a rejected value showing
    showStatus('Invalid URL — not saved');
    return;
  }

  try {
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      input.value = lastSavedBackendUrl; // restore — storage still holds the old value
      showStatus('Permission denied — Deep Scan can’t reach this URL');
      return;
    }
  } catch {
    // permissions API unavailable (e.g. already a static host permission) — proceed
  }

  lastSavedBackendUrl = url;
  save({ backendUrl: url });
});

// Back button
document.getElementById('btn-back')?.addEventListener('click', () => {
  window.location.href = '../popup/popup.html';
});

function save(data: Record<string, unknown>) {
  chrome.storage.local.set(data, () => showStatus('Settings saved'));
}

function showStatus(message: string) {
  const indicator = document.getElementById('saved-indicator')!;
  indicator.textContent = message;
  indicator.hidden = false;
  // Reset animation
  indicator.style.animation = 'none';
  indicator.offsetHeight; // trigger reflow
  indicator.style.animation = '';
  setTimeout(() => { indicator.hidden = true; }, 1500);
}
