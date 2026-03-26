// Load current settings
chrome.storage.local.get(['mode', 'deepScanEnabled'], (result) => {
  const mode = result.mode || 'A';
  const deepScan = result.deepScanEnabled || false;

  // Set mode radio
  const radio = document.querySelector(`input[name="mode"][value="${mode}"]`) as HTMLInputElement;
  if (radio) {
    radio.checked = true;
    radio.closest('.mode-option')?.classList.add('selected');
  }

  // Set deep scan toggle
  (document.getElementById('deep-scan-toggle') as HTMLInputElement).checked = deepScan;
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

// Back button
document.getElementById('btn-back')?.addEventListener('click', () => {
  window.location.href = '../popup/popup.html';
});

function save(data: Record<string, unknown>) {
  chrome.storage.local.set(data, () => {
    const indicator = document.getElementById('saved-indicator')!;
    indicator.hidden = false;
    // Reset animation
    indicator.style.animation = 'none';
    indicator.offsetHeight; // trigger reflow
    indicator.style.animation = '';
    setTimeout(() => { indicator.hidden = true; }, 1500);
  });
}
