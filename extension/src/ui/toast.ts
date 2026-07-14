/**
 * Shared on-page toast for sanitize events (Modes A and C).
 *
 * ONE render function serves both surfaces so their look and copy can never
 * drift again:
 *  - the Mode A content script imports and calls it directly;
 *  - the Mode C service worker injects it via chrome.scripting.executeScript.
 *
 * executeScript serializes the function with toString() and runs it in the
 * page's isolated world, so the function body must be fully self-contained:
 * no imports, no closures, no references to module scope.
 *
 * Privacy: the toast lists detection TYPE labels only — never the raw values
 * (they would be echoed back into the page DOM).
 *
 * e2e/csp-toast-verify.mjs asserts the literals '.ps-toast-v2',
 * '#ps-toast-v2-style', '.ps-t-head span' and z-index 2147483647 (it can't
 * import this module) — renaming any of them means updating that script.
 */

export interface SanitizerToastItem {
  label: string;
  severity: string; // 'high' | 'medium' | 'low'
}

export interface SanitizerToastPayload {
  headline: string;
  items: SanitizerToastItem[];
  footer: string;
  /**
   * Original text to put back on the clipboard when the user clicks Undo.
   * Held in memory only and NEVER rendered into the DOM (it is the page's own
   * selection, so the page already had it — but echoing it into markup would
   * still be a needless copy). Omit for toasts with nothing to undo.
   */
  undoText?: string;
}

/**
 * Optional callbacks for direct (same-world) callers. The executeScript path
 * passes only the payload via args, so `hooks` is undefined there — the undo
 * button still restores the clipboard, it just has no extra side effects.
 */
export interface SanitizerToastHooks {
  /** Runs after the clipboard restore succeeds (e.g. arm a re-intercept snooze). */
  onUndone?: () => void;
}

export function renderSanitizerToast(
  payload: {
    headline: string;
    items: { label: string; severity: string }[];
    footer: string;
    undoText?: string;
  },
  hooks?: { onUndone?: () => void }
): void {
  // Remove any previous toast
  document.querySelector('.ps-toast-v2')?.remove();

  if (!document.querySelector('#ps-toast-v2-style')) {
    const style = document.createElement('style');
    style.id = 'ps-toast-v2-style';
    style.textContent = `
      .ps-toast-v2 {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        background: #FFFFFF; color: #111A2C;
        border: 1px solid #DDE4EE; border-left: 4px solid #0F7B4D;
        border-radius: 10px; padding: 11px 14px;
        font-family: system-ui, -apple-system, sans-serif; font-size: 12.5px;
        line-height: 1.45; box-shadow: 0 1px 2px rgba(16,24,40,.08), 0 10px 32px rgba(16,24,40,.12);
        max-width: 330px; animation: psToastIn 0.25s ease-out;
      }
      .ps-toast-v2.ps-fading { opacity: 0; transition: opacity 0.3s; }
      @keyframes psToastIn { from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .ps-toast-v2 { animation: none; }
        .ps-toast-v2.ps-fading { transition: none; }
      }
      @media (prefers-color-scheme: dark) {
        .ps-toast-v2 {
          background: #15203A; color: #E9EFF8; border-color: #2A3A5C;
          border-left-color: #5BC492;
          box-shadow: 0 1px 2px rgba(0,0,0,.45), 0 14px 44px rgba(0,0,0,.4);
        }
      }
      .ps-toast-v2 .ps-t-head { display: flex; align-items: center; gap: 8px; font-weight: 650; }
      .ps-toast-v2 .ps-t-shield { width: 18px; height: 18px; flex: none; }
      .ps-toast-v2 .ps-t-close {
        margin-left: auto; border: none; background: none; cursor: pointer;
        color: inherit; opacity: .55; font-size: 15px; line-height: 1;
        padding: 4px 6px; border-radius: 5px;
      }
      .ps-toast-v2 .ps-t-close:hover, .ps-toast-v2 .ps-t-close:focus-visible { opacity: 1; }
      .ps-toast-v2 .ps-t-items { margin-top: 7px; font-size: 11.5px; opacity: .92; }
      .ps-toast-v2 .ps-t-item { display: flex; align-items: center; gap: 7px; margin-top: 3px; }
      .ps-toast-v2 .ps-t-dot { width: 7px; height: 7px; flex: none; box-sizing: border-box; }
      .ps-toast-v2 .ps-t-dot.high { background: #B3261E; border-radius: 50%; }
      .ps-toast-v2 .ps-t-dot.medium { background: #8A5A00; border-radius: 1.5px; }
      .ps-toast-v2 .ps-t-dot.low { background: transparent; border: 1.4px solid #5B6B7E; border-radius: 50%; }
      @media (prefers-color-scheme: dark) {
        .ps-toast-v2 .ps-t-dot.high { background: #F28B82; }
        .ps-toast-v2 .ps-t-dot.medium { background: #E0BB5C; }
        .ps-toast-v2 .ps-t-dot.low { border-color: #93A5BD; }
      }
      .ps-toast-v2 .ps-t-foot { margin-top: 8px; font-size: 11px; opacity: .75; }
      .ps-toast-v2 .ps-t-actions { margin-top: 9px; display: flex; gap: 8px; }
      .ps-toast-v2 .ps-t-undo {
        border: 1px solid #C7D2E3; background: none; color: inherit; cursor: pointer;
        font: inherit; font-size: 11.5px; font-weight: 600;
        padding: 4px 10px; border-radius: 6px;
      }
      .ps-toast-v2 .ps-t-undo:hover, .ps-toast-v2 .ps-t-undo:focus-visible { background: rgba(0,42,92,.06); }
      .ps-toast-v2 .ps-t-undo:disabled { cursor: default; opacity: .8; }
      @media (prefers-color-scheme: dark) {
        .ps-toast-v2 .ps-t-undo { border-color: #3A4C6B; }
        .ps-toast-v2 .ps-t-undo:hover, .ps-toast-v2 .ps-t-undo:focus-visible { background: rgba(255,255,255,.08); }
      }
    `;
    document.head.appendChild(style);
  }

  const esc = (s: string) => {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  const toast = document.createElement('div');
  toast.className = 'ps-toast-v2';
  // role=alert is the one live-region pattern reliably announced when a node
  // is inserted into the DOM already populated (implies assertive + atomic).
  toast.setAttribute('role', 'alert');

  const shieldSvg =
    '<svg class="ps-t-shield" viewBox="0 0 128 128" aria-hidden="true">' +
    '<rect width="128" height="128" rx="24" fill="#002A5C"/>' +
    '<polygon points="33,26 95,26 95,64 91.5,77 84.5,88 75,98 64,105 53,98 43.5,88 36.5,77 33,64" fill="#E8ECF2"/></svg>';

  const maxItems = 3;
  let itemsHtml = '';
  for (const item of payload.items.slice(0, maxItems)) {
    const sev = item.severity === 'high' || item.severity === 'medium' ? item.severity : 'low';
    itemsHtml += `<div class="ps-t-item"><span class="ps-t-dot ${sev}"></span>${esc(item.label)}</div>`;
  }
  if (payload.items.length > maxItems) {
    itemsHtml += `<div class="ps-t-item">+${payload.items.length - maxItems} more</div>`;
  }

  toast.innerHTML = `
    <div class="ps-t-head">${shieldSvg}<span>${esc(payload.headline)}</span>
      <button class="ps-t-close" aria-label="Dismiss notification">&times;</button></div>
    ${itemsHtml ? `<div class="ps-t-items">${itemsHtml}</div>` : ''}
    <div class="ps-t-foot">${esc(payload.footer)}</div>
    ${payload.undoText ? '<div class="ps-t-actions"><button class="ps-t-undo">Undo — keep the original</button></div>' : ''}
  `;

  // Auto-dismiss with hover/focus pause; explicit close button.
  let timer: number | undefined;
  const stopTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const startTimer = () => {
    // Reset-then-start: consecutive resume events (mouseleave + focusout)
    // must never orphan a running timeout, or the pause guarantee breaks.
    stopTimer();
    timer = window.setTimeout(() => {
      toast.classList.add('ps-fading');
      window.setTimeout(() => toast.remove(), 320);
    }, 8000);
  };
  toast.addEventListener('mouseenter', stopTimer);
  toast.addEventListener('focusin', stopTimer);
  toast.addEventListener('mouseleave', startTimer);
  toast.addEventListener('focusout', startTimer);
  toast.querySelector('.ps-t-close')?.addEventListener('click', () => {
    stopTimer();
    toast.remove();
  });

  const undoBtn = toast.querySelector('.ps-t-undo') as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.addEventListener('click', (ev) => {
      // Page-synthesized clicks (el.click()) must not restore raw text or arm
      // the snooze — that would let a hostile page switch the protection off.
      // Real activations (mouse, or Enter/Space on the focused button) are
      // isTrusted; clipboard writes need real user activation anyway.
      if (!ev.isTrusted) return;
      stopTimer();
      navigator.clipboard.writeText(payload.undoText as string).then(
        () => {
          undoBtn.textContent = 'Original restored ✓';
          undoBtn.disabled = true;
          if (hooks && hooks.onUndone) hooks.onUndone();
          window.setTimeout(() => toast.remove(), 1400);
        },
        () => {
          // Focus was lost between copy and click — tell the user how to retry.
          undoBtn.textContent = 'Undo failed — click the page, then retry';
          startTimer();
        }
      );
    });
  }

  document.body.appendChild(toast);
  startTimer();
}
