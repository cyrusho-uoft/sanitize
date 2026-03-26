import { scanL1, Detection } from '../scanner';
import { tokenize, detokenize, clearMappings } from '../tokenizer';
import explanations from '../knowledge/explanations.json';

let currentDetections: Detection[] = [];

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const targetId = `tab-${(tab as HTMLElement).dataset.tab}`;
    document.getElementById(targetId)?.classList.add('active');
  });
});

// --- Scan ---
const inputText = document.getElementById('input-text') as HTMLTextAreaElement;
const statusBar = document.getElementById('status-bar') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const summaryBar = document.getElementById('summary-bar') as HTMLElement;
const summaryHigh = document.getElementById('summary-high') as HTMLElement;
const summaryMedium = document.getElementById('summary-medium') as HTMLElement;
const detectionsEl = document.getElementById('detections') as HTMLElement;
const actionsEl = document.getElementById('actions') as HTMLElement;
const emptyState = document.getElementById('empty-state') as HTMLElement;
const btnSanitize = document.getElementById('btn-sanitize') as HTMLButtonElement;
const btnDismissAll = document.getElementById('btn-dismiss-all') as HTMLButtonElement;

let scanTimeout: number | null = null;

inputText.addEventListener('input', () => {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = window.setTimeout(runScan, 150);
});

// Also scan on paste immediately
inputText.addEventListener('paste', () => {
  setTimeout(runScan, 0);
});

function runScan() {
  const text = inputText.value;
  currentDetections = scanL1(text);
  renderResults();
}

function renderResults() {
  const text = inputText.value;

  if (!text.trim()) {
    statusBar.hidden = true;
    summaryBar.hidden = true;
    detectionsEl.innerHTML = '';
    actionsEl.hidden = true;
    emptyState.hidden = true;
    return;
  }

  statusBar.hidden = false;

  if (currentDetections.length === 0) {
    statusBar.classList.remove('has-detections');
    statusText.textContent = 'Scanned — no sensitive information found';
    summaryBar.hidden = true;
    detectionsEl.innerHTML = '';
    actionsEl.hidden = true;
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  statusBar.classList.add('has-detections');
  statusText.textContent = `Scanned · ${currentDetections.length} item${currentDetections.length > 1 ? 's' : ''} detected`;

  // Summary counts
  const highCount = currentDetections.filter(d => d.severity === 'high').length;
  const mediumCount = currentDetections.filter(d => d.severity === 'medium').length;

  summaryBar.hidden = false;
  summaryHigh.textContent = `${highCount} High`;
  summaryHigh.className = `summary-item${highCount > 0 ? ' high' : ''}`;
  summaryMedium.textContent = `${mediumCount} Medium`;
  summaryMedium.className = `summary-item${mediumCount > 0 ? ' medium' : ''}`;

  // Detection cards
  detectionsEl.innerHTML = '';
  for (const detection of currentDetections) {
    const exp = (explanations as Record<string, { title: string; why: string; action: string }>)[detection.explanationKey];
    const card = document.createElement('div');
    card.className = `detection-card ${detection.severity}`;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label', `${detection.severity} severity: ${exp?.title || detection.type}. Value: ${detection.value}`);
    card.innerHTML = `
      <button class="detection-dismiss" title="Dismiss" aria-label="Dismiss this detection">&times;</button>
      <div class="detection-label ${detection.severity}">
        ${exp?.title || detection.type}
        <span class="layer-badge">${detection.layer}</span>
        <span>${detection.severity.toUpperCase()}</span>
      </div>
      <code class="detection-value">${escapeHtml(detection.value)}</code>
      <div class="detection-explain">
        <strong>Why this matters:</strong> ${exp?.why || 'This information could identify you or others.'}
      </div>
    `;

    card.querySelector('.detection-dismiss')?.addEventListener('click', () => {
      currentDetections = currentDetections.filter(d => d !== detection);
      renderResults();
    });

    detectionsEl.appendChild(card);
  }

  actionsEl.hidden = false;
}

// --- Sanitize & Copy ---
btnSanitize.addEventListener('click', async () => {
  if (currentDetections.length === 0) return;

  const sanitized = tokenize(inputText.value, currentDetections);

  try {
    await navigator.clipboard.writeText(sanitized);
    btnSanitize.textContent = 'Copied \u2713';
    btnSanitize.classList.add('copied');
    setTimeout(() => {
      btnSanitize.textContent = 'Sanitize & Copy';
      btnSanitize.classList.remove('copied');
    }, 2000);
  } catch {
    btnSanitize.textContent = "Couldn't copy — try again";
    setTimeout(() => { btnSanitize.textContent = 'Sanitize & Copy'; }, 2000);
  }
});

// --- Dismiss All ---
btnDismissAll.addEventListener('click', () => {
  currentDetections = [];
  renderResults();
});

// --- Restore tab ---
const restoreText = document.getElementById('restore-text') as HTMLTextAreaElement;
const btnRestore = document.getElementById('btn-restore') as HTMLButtonElement;
const restoreResult = document.getElementById('restore-result') as HTMLElement;
const restoreCount = document.getElementById('restore-count') as HTMLElement;

btnRestore.addEventListener('click', async () => {
  const text = restoreText.value;
  if (!text.trim()) return;

  const { result, restored } = detokenize(text);

  if (restored === 0) {
    restoreResult.hidden = false;
    restoreCount.textContent = 'No tokens found in this text. Make sure you sanitized first in this tab session.';
    restoreCount.style.color = 'var(--text-secondary)';
    return;
  }

  try {
    await navigator.clipboard.writeText(result);
    restoreResult.hidden = false;
    restoreCount.textContent = `${restored} item${restored > 1 ? 's' : ''} restored. Copied to clipboard!`;
    restoreCount.style.color = 'var(--success)';
  } catch {
    restoreResult.hidden = false;
    restoreCount.textContent = "Couldn't copy — try again";
    restoreCount.style.color = 'var(--severity-high)';
  }
});

// --- Settings button ---
document.getElementById('btn-settings')?.addEventListener('click', () => {
  window.location.href = '../settings/settings.html';
});

// --- Utility ---
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
