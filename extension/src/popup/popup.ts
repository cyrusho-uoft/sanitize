import { scanL1, mergeDetections, Detection } from '../scanner';
import { tokenize, detokenize, getMappingCount, TYPE_LABELS, PLACEHOLDER_RE } from '../tokenizer';
import { loadBatchSummaries, getRestoreEventCount } from '../tokenizer/mapping-store';
import { loadDeepScanSettings, requestDeepScan } from '../settings/deep-scan';
import explanations from '../knowledge/explanations.json';

let currentDetections: Detection[] = [];
// Detections the user chose to keep as-is. Keyed by identity so a re-scan of
// the same text doesn't resurrect them (and can't mark different text stale).
// The Detection objects are retained so Keep decisions survive the async L2
// merge even when the winning detection has different span boundaries.
const keptKeys = new Set<string>();
const keptDetections = new Map<string, Detection>();
const detectionKey = (d: Detection) => `${d.type}|${d.value}|${d.start}`;

function markKept(d: Detection): void {
  keptKeys.add(detectionKey(d));
  keptDetections.set(detectionKey(d), d);
}

/** Deep Scan status for the current scan — drives the empty-state copy. */
let deepScanState: 'off' | 'pending' | 'done' = 'off';

// Clear the attention badge — the popup opening IS the "review" action.
// (A chrome.action.onClicked listener can't do this: it never fires when the
// manifest declares a default_popup.)
chrome.action.setBadgeText({ text: '' });

// --- Tab switching (full ARIA tabs pattern: click + arrow keys) ---
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));

function activateTab(tab: HTMLButtonElement) {
  tabs.forEach(t => {
    const selected = t === tab;
    t.classList.toggle('active', selected);
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
}

// --- Flow stage (stepper) ---
const flowAsk = document.getElementById('flow-ask') as HTMLElement;
const tabScanBtn = document.getElementById('tabbtn-scan') as HTMLButtonElement;

/** 'protect': working on step 1. 'copied': safe copy made — step 2 is live. */
function setFlowStage(stage: 'protect' | 'copied') {
  tabScanBtn.classList.toggle('done', stage === 'copied');
  flowAsk.classList.toggle('on', stage === 'copied');
}

/** Keys the last Sanitize & Copy actually replaced — used to downgrade the
 *  stepper if the async Deep Scan merge later surfaces NEW detections. */
let copiedKeys: Set<string> | null = null;

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (e) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      tabs[next].focus();
      activateTab(tabs[next]);
    }
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
const emptySubtitle = document.getElementById('empty-subtitle') as HTMLElement;
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

async function runScan() {
  const text = inputText.value;
  keptKeys.clear(); // new text, fresh decisions
  keptDetections.clear();
  setFlowStage('protect'); // new text — back to step 1
  copiedKeys = null;
  const ds = await loadDeepScanSettings();
  deepScanState = ds.enabled ? 'pending' : 'off';
  const l1 = scanL1(text);
  currentDetections = l1;
  renderResults(); // render L1 immediately; L2 (if enabled) refines below

  if (!text.trim() || !ds.enabled) return;

  const l2 = await requestDeepScan(text);
  if (inputText.value !== text) return; // input changed during the async scan — drop stale result
  const merged = mergeDetections(l1, l2);
  // Carry Keep decisions across the merge: if a winning detection covers the
  // same entity type over an overlapping span as a kept one, keep it too.
  for (const d of merged) {
    if (keptKeys.has(detectionKey(d))) continue;
    for (const kept of keptDetections.values()) {
      if (kept.type === d.type && d.start < kept.end && kept.start < d.end) {
        markKept(d);
        break;
      }
    }
  }
  currentDetections = merged;
  deepScanState = 'done';
  // If the merge surfaced detections the earlier copy never replaced, the
  // "safe copy ready" stepper state is no longer true — fall back to step 1.
  if (copiedKeys && activeDetections().some(d => !copiedKeys!.has(detectionKey(d)))) {
    setFlowStage('protect');
    copiedKeys = null;
  }
  renderResults();
}

/** Detections still slated for replacement (not marked "keep original"). */
function activeDetections(): Detection[] {
  return currentDetections.filter(d => !keptKeys.has(detectionKey(d)));
}

function renderResults() {
  const text = inputText.value;
  const active = activeDetections();
  const keptCount = currentDetections.length - active.length;

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
    statusText.textContent = 'Scanned — no sensitive patterns found';
    // Scope the claim to what actually ran — Deep Scan may be off or in flight.
    emptySubtitle.textContent =
      deepScanState === 'off'
        ? 'This scan checks U of T IDs, government numbers, emails, phone and card numbers. Names and places need Deep Scan (Settings).'
        : deepScanState === 'pending'
          ? 'Quick local scan is clean — Deep Scan (names, places, organizations) is still checking…'
          : 'Local scan and Deep Scan (names, places, organizations) both came back clean.';
    summaryBar.hidden = true;
    detectionsEl.innerHTML = '';
    actionsEl.hidden = true;
    emptyState.hidden = false;
    return;
  }

  if (active.length === 0) {
    // Everything was explicitly kept — say that, never "looks safe".
    statusBar.classList.add('has-detections');
    statusText.textContent = `${keptCount} detected item${keptCount > 1 ? 's' : ''} kept as-is — nothing will be replaced`;
    summaryBar.hidden = true;
    detectionsEl.innerHTML = '';
    actionsEl.hidden = true;
    emptyState.hidden = true;
    return;
  }

  emptyState.hidden = true;
  statusBar.classList.add('has-detections');
  statusText.textContent =
    `Scanned · ${active.length} item${active.length > 1 ? 's' : ''} to replace` +
    (keptCount > 0 ? ` · ${keptCount} kept as-is` : '');

  // Summary counts
  const highCount = active.filter(d => d.severity === 'high').length;
  const mediumCount = active.filter(d => d.severity === 'medium').length;

  summaryBar.hidden = false;
  summaryHigh.textContent = `${highCount} High`;
  summaryHigh.className = `summary-item${highCount > 0 ? ' high' : ''}`;
  summaryMedium.textContent = `${mediumCount} Medium`;
  summaryMedium.className = `summary-item${mediumCount > 0 ? ' medium' : ''}`;

  // Preview placeholders with the same numbering tokenize() will use
  // (it assigns counters in descending-position order); the 4-char tag is
  // minted at copy time, shown as ···· until then.
  const previews = new Map<Detection, string>();
  const previewCounters: Record<string, number> = {};
  for (const d of [...active].sort((a, b) => b.start - a.start)) {
    const label = TYPE_LABELS[d.type] || d.type.toUpperCase();
    previewCounters[label] = (previewCounters[label] || 0) + 1;
    previews.set(d, `[${label}_${previewCounters[label]}~····]`);
  }

  // Detection cards
  detectionsEl.innerHTML = '';
  for (const detection of active) {
    const exp = (explanations as Record<string, { title: string; why: string; action: string }>)[detection.explanationKey];
    const card = document.createElement('div');
    card.className = `detection-card ${detection.severity}`;
    card.setAttribute('role', 'listitem');
    card.setAttribute(
      'aria-label',
      `${detection.severity} severity: ${exp?.title || detection.type}. ` +
        `${detection.value} will be replaced with ${previews.get(detection) || 'a placeholder token'}`
    );
    card.innerHTML = `
      <button class="detection-dismiss" title="Keep the original value — it will NOT be replaced"
        aria-label="Keep original value for this detection">Keep</button>
      <div class="detection-label ${detection.severity}">
        ${escapeHtml(exp?.title || detection.type)}
        <span class="layer-badge">${detection.layer === 'L2' ? 'Deep Scan' : 'Local'}</span>
        <span>${detection.severity.toUpperCase()}</span>
      </div>
      <div class="detection-diff">
        <span class="diff-old">${escapeHtml(detection.value)}</span>
        <span class="diff-arrow" aria-hidden="true">→</span>
        <code class="diff-token">${escapeHtml(previews.get(detection) || '')}</code>
      </div>
      <details class="detection-explain">
        <summary>Why this matters</summary>
        <p>${exp?.why || 'This information could identify you or others.'}</p>
      </details>
    `;

    card.querySelector('.detection-dismiss')?.addEventListener('click', () => {
      markKept(detection);
      renderResults();
      // Keep keyboard users in the list instead of dropping focus to <body>;
      // when the last card goes, land on a stable control.
      const next =
        (detectionsEl.querySelector('.detection-dismiss') as HTMLElement | null) ??
        (btnSanitize.offsetParent !== null ? btnSanitize : inputText);
      next.focus();
    });

    detectionsEl.appendChild(card);
  }

  actionsEl.hidden = false;
}

// --- Sanitize & Copy ---
btnSanitize.addEventListener('click', async () => {
  const active = activeDetections();
  if (active.length === 0) return;

  const sanitized = tokenize(inputText.value, active, { source: 'popup' });

  try {
    await navigator.clipboard.writeText(sanitized);
    // Teach the round-trip at the exact moment it becomes relevant — and be
    // honest when kept originals are included in the copy.
    const keptCount = currentDetections.length - active.length;
    statusBar.hidden = false;
    statusText.textContent = keptCount > 0
      ? `Copied — ${active.length} item${active.length > 1 ? 's' : ''} replaced, ${keptCount} kept original${keptCount > 1 ? 's' : ''} included as-is. Paste the AI's reply into step 3 (Restore) to bring real values back.`
      : 'Safe copy on your clipboard. Paste it into the AI tool — then paste the reply into step 3 (Restore) to bring real values back.';
    setFlowStage('copied');
    copiedKeys = new Set(active.map(detectionKey));
    void refreshActivity();
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

// --- Keep All ---
btnDismissAll.addEventListener('click', () => {
  currentDetections.forEach(markKept);
  renderResults();
});

// --- Restore tab ---
const restoreText = document.getElementById('restore-text') as HTMLTextAreaElement;
const btnRestore = document.getElementById('btn-restore') as HTMLButtonElement;
const restoreResult = document.getElementById('restore-result') as HTMLElement;
const restoreCount = document.getElementById('restore-count') as HTMLElement;

btnRestore.addEventListener('click', async () => {
  const text = restoreText.value;
  if (!text.trim()) {
    restoreCount.textContent = 'Paste the sanitized text or the AI’s reply above first.';
    restoreCount.style.color = 'var(--text-secondary)';
    return;
  }

  const { result, restored } = await detokenize(text);

  if (restored === 0) {
    // Diagnose instead of one catch-all message — the causes need
    // different next steps from the user.
    restoreCount.style.color = 'var(--text-secondary)';
    if (PLACEHOLDER_RE.test(text)) {
      const stored = await getMappingCount();
      restoreCount.textContent = stored === 0
        ? 'This text has placeholders, but their mappings are gone — they only last until the browser closes or the extension updates. The original values can’t be recovered here.'
        : 'This text has placeholders, but none match this session’s sanitize actions. Restore only works for text sanitized recently in this browser session.';
    } else {
      restoreCount.textContent = 'No placeholders (like [EMAIL_1~ABCD]) found in this text — nothing to restore.';
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(result);
    restoreCount.textContent = `${restored} item${restored > 1 ? 's' : ''} restored. Copied to clipboard!`;
    restoreCount.style.color = 'var(--success)';
    void refreshActivity();
  } catch {
    restoreCount.textContent = "Couldn't copy — try again";
    restoreCount.style.color = 'var(--severity-high)';
  }
});

// --- Settings button ---
document.getElementById('btn-settings')?.addEventListener('click', () => {
  // from=popup lets settings show its back button only for this entry point
  // (the page is also embedded by chrome://extensions via options_ui).
  window.location.href = '../settings/settings.html?from=popup';
});

// --- Session activity ---
const sessionSummary = document.getElementById('session-summary') as HTMLElement;
const btnActivity = document.getElementById('btn-activity') as HTMLButtonElement;
const activityPanel = document.getElementById('activity-panel') as HTMLElement;
const activityList = document.getElementById('activity-list') as HTMLElement;

const SOURCE_LABELS: Record<string, string> = {
  paste: 'AI-site guard',
  copy: 'Copy guard',
  shortcut: 'Shortcut',
  popup: 'Popup',
  unknown: 'Sanitize',
};

async function refreshActivity(): Promise<void> {
  try {
    const [summaries, restores] = await Promise.all([
      loadBatchSummaries(),
      getRestoreEventCount(),
    ]);

    const protectedCount = summaries.reduce((n, s) => n + s.count, 0);
    // "Recent activity", not a session total — the store keeps only the most
    // recent batches (64-batch cap, oldest evicted first).
    sessionSummary.textContent =
      summaries.length === 0 && restores === 0
        ? 'Recent activity · none yet'
        : `Recent activity · ${protectedCount} replacement${protectedCount === 1 ? '' : 's'} · ${restores} restore${restores === 1 ? '' : 's'} this session`;

    activityList.innerHTML = '';
    if (summaries.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No sanitize events yet this session.';
      activityList.appendChild(li);
      return;
    }
    for (const s of summaries.slice(0, 20)) {
      const li = document.createElement('li');
      const time = new Date(s.createdAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
      li.textContent =
        `${time} · ${SOURCE_LABELS[s.source] || s.source}` +
        (s.site ? ` · ${s.site}` : '') +
        ` · ${s.count} item${s.count === 1 ? '' : 's'}`;
      activityList.appendChild(li);
    }
    if (summaries.length > 20) {
      const li = document.createElement('li');
      li.textContent = `…and ${summaries.length - 20} earlier event${summaries.length - 20 === 1 ? '' : 's'}`;
      activityList.appendChild(li);
    }
  } catch {
    sessionSummary.textContent = 'This session · activity unavailable';
  }
}

btnActivity.addEventListener('click', () => {
  const open = activityPanel.hidden;
  activityPanel.hidden = !open;
  btnActivity.setAttribute('aria-expanded', String(open));
  if (open) void refreshActivity();
});

void refreshActivity();

// --- Utility ---
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
