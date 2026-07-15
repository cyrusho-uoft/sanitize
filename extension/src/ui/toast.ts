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
 * Hardening: the toast renders inside a CLOSED shadow root on a host element
 * whose layout/visibility are locked with inline !important. This closes the
 * DANGEROUS attacks a hostile page (Mode B runs on <all_urls>) could mount:
 * it cannot read, restyle, inject into, focus, or click the card/Undo button
 * (closed shadow → no handle; Undo also requires isTrusted), and cannot hide
 * the host with a page STYLESHEET (inline importance outranks it). It does NOT
 * make the notice unconditionally tamper-proof: a page's own JavaScript can
 * remove/restyle this light-DOM host node, and ancestor compositing CSS
 * (body/html opacity/filter/transform/display) can hide any fixed child — both
 * merely SUPPRESS the notice (content is already sanitized, so it stays safe;
 * the toolbar badge + popup are the surfaces a page can't touch). See the
 * inline threat-scope note in renderSanitizerToast.
 *
 * Privacy: the toast lists detection TYPE labels only — never the raw values
 * (they would be echoed back into the page DOM).
 *
 * e2e/csp-toast-verify.mjs asserts the host `[data-ps-toast-host]` and its
 * computed position/z-index/visibility (it can't reach the closed shadow
 * content) — renaming the host attribute means updating that script.
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
  // Remove ALL prior toast hosts (removeAll, not the first match: a hostile
  // page could plant a decoy [data-ps-toast-host] earlier in the tree and make
  // a single ?.remove() delete the decoy while our real prior toast lingers).
  document.querySelectorAll('[data-ps-toast-host]').forEach((el) => el.remove());

  // Non-HTML documents (raw XML/SVG viewers under <all_urls>) have no body.
  // The clipboard was already rewritten by the time we get here, so a throw
  // would leave a silent rewrite with no notice — fall back to documentElement.
  const toastRoot = document.body || document.documentElement;
  if (!toastRoot) return;

  // Host lives in the page's light DOM. Its layout+visibility are locked inline
  // with !important, which outranks any page STYLESHEET (even one using
  // !important) targeting the host. Fade-out animates the inner card, never
  // these host properties, so the lock doesn't fight it.
  //
  // Threat scope — what this does and does NOT stop. The closed shadow root
  // below makes the card and its Undo button unreachable to page scripts (no
  // handle, can't be read/restyled/focused/clicked), and the Undo handler
  // additionally requires isTrusted — so a hostile page can NOT force an undo,
  // read the card, or reach its internals. What in-page UI can never fully
  // resist is a hostile page's own JavaScript (it can remove or restyle this
  // light-DOM host node) or ancestor compositing CSS (body/html
  // opacity/filter/transform/display can hide any fixed child regardless of the
  // child's own !important) — both can visually SUPPRESS the notice. That only
  // hides the message: the clipboard/field is already sanitized, so content
  // stays safe, and the toolbar badge + popup (surfaces the page can't touch)
  // remain the tamper-proof fallback.
  const host = document.createElement('div');
  host.setAttribute('data-ps-toast-host', '');
  const hostLock: Record<string, string> = {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    'z-index': '2147483647',
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    'pointer-events': 'auto',
    margin: '0',
    padding: '0',
    border: '0',
    width: 'auto',
    height: 'auto',
    'max-width': '92vw',
    transform: 'none',
    clip: 'auto',
    'clip-path': 'none',
  };
  for (const prop in hostLock) host.style.setProperty(prop, hostLock[prop], 'important');

  // Prefer a closed shadow root (isolation + hardening). attachShadow throws on
  // non-HTML-namespace elements — e.g. inside a raw XML/SVG document, where
  // createElement makes a null-namespace div — so degrade to rendering the card
  // directly in the host (light DOM) rather than throwing and showing nothing.
  // The card's <style> applies globally there, which is acceptable on such
  // viewer pages; the visible harm we must avoid is a silent rewrite.
  let root: ShadowRoot | HTMLElement;
  try {
    root = host.attachShadow({ mode: 'closed' });
  } catch {
    root = host;
  }
  const style = document.createElement('style');
  style.textContent = `
      .ps-toast-v2 {
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
      .ps-t-head { display: flex; align-items: center; gap: 8px; font-weight: 650; }
      .ps-t-shield { width: 18px; height: 18px; flex: none; }
      .ps-t-close {
        margin-left: auto; border: none; background: none; cursor: pointer;
        color: inherit; opacity: .55; font-size: 15px; line-height: 1;
        padding: 4px 6px; border-radius: 5px;
      }
      .ps-t-close:hover, .ps-t-close:focus-visible { opacity: 1; }
      .ps-t-items { margin-top: 7px; font-size: 11.5px; opacity: .92; }
      .ps-t-item { display: flex; align-items: center; gap: 7px; margin-top: 3px; }
      .ps-t-dot { width: 7px; height: 7px; flex: none; box-sizing: border-box; }
      .ps-t-dot.high { background: #B3261E; border-radius: 50%; }
      .ps-t-dot.medium { background: #8A5A00; border-radius: 1.5px; }
      .ps-t-dot.low { background: transparent; border: 1.4px solid #5B6B7E; border-radius: 50%; }
      @media (prefers-color-scheme: dark) {
        .ps-t-dot.high { background: #F28B82; }
        .ps-t-dot.medium { background: #E0BB5C; }
        .ps-t-dot.low { border-color: #93A5BD; }
      }
      .ps-t-foot { margin-top: 8px; font-size: 11px; opacity: .75; }
      .ps-t-actions { margin-top: 9px; display: flex; gap: 8px; }
      .ps-t-undo {
        border: 1px solid #C7D2E3; background: none; color: inherit; cursor: pointer;
        font: inherit; font-size: 11.5px; font-weight: 600;
        padding: 4px 10px; border-radius: 6px;
      }
      .ps-t-undo:hover, .ps-t-undo:focus-visible { background: rgba(0,42,92,.06); }
      .ps-t-undo:disabled { cursor: default; opacity: .8; }
      @media (prefers-color-scheme: dark) {
        .ps-t-undo { border-color: #3A4C6B; }
        .ps-t-undo:hover, .ps-t-undo:focus-visible { background: rgba(255,255,255,.08); }
      }
    `;
  root.appendChild(style);

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

  // Only offer Undo where the Clipboard API is actually usable. It is
  // SecureContext-only and undefined on http:// pages (Mode B runs on
  // <all_urls>): rather than a fallback via execCommand('copy') — which our
  // own Mode B copy interceptor would re-sanitize — we simply omit the button
  // on insecure pages. The toast still notifies; protection stays on.
  const canUndo =
    !!payload.undoText && !!(navigator.clipboard && navigator.clipboard.writeText);

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
    ${canUndo ? '<div class="ps-t-actions"><button class="ps-t-undo">Undo — keep the original</button></div>' : ''}
  `;

  // Auto-dismiss with hover/focus pause; explicit close button. Removing the
  // host tears down the shadow tree with it.
  const remove = () => host.remove();
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
      window.setTimeout(remove, 320);
    }, 8000);
  };
  toast.addEventListener('mouseenter', stopTimer);
  toast.addEventListener('focusin', stopTimer);
  toast.addEventListener('mouseleave', startTimer);
  toast.addEventListener('focusout', startTimer);
  toast.querySelector('.ps-t-close')?.addEventListener('click', () => {
    stopTimer();
    remove();
  });

  const undoBtn = toast.querySelector('.ps-t-undo') as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.addEventListener('click', (ev) => {
      // Page-synthesized clicks (el.click()) must not restore raw text or arm
      // the snooze — that would let a hostile page switch the protection off.
      // Real activations (mouse, or Enter/Space on the focused button) are
      // isTrusted; clipboard writes need real user activation anyway.
      if (!ev.isTrusted || undoBtn.disabled) return;
      // Disable synchronously: a double-click must not fire two writes or arm
      // the snooze twice.
      undoBtn.disabled = true;
      stopTimer();
      navigator.clipboard.writeText(payload.undoText as string).then(
        () => {
          undoBtn.textContent = 'Original restored ✓';
          // Only arm the snooze if this toast is still the live one — an
          // in-flight undo whose host was already replaced by a newer sanitize
          // must not silently disable interception the user can no longer see.
          if (host.isConnected && hooks && hooks.onUndone) hooks.onUndone();
          window.setTimeout(remove, 1400);
        },
        () => {
          // Focus was lost between copy and click — let the user retry. Do NOT
          // restart the auto-dismiss here: focus/pointer is still on the toast,
          // so it would fade mid-read and take the retry affordance with it.
          // The existing mouseleave/focusout listeners re-arm dismissal when
          // the user actually leaves.
          undoBtn.textContent = 'Undo failed — click the page, then retry';
          undoBtn.disabled = false;
        }
      );
    });
  }

  // Populate the shadow tree first, then connect the host — role=alert is
  // announced when the already-populated node enters the document.
  root.appendChild(toast);
  toastRoot.appendChild(host);
  startTimer();
}
