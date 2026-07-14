# TODOS

## TODO: Design-audit follow-ups (core + bets)
**Priority:** Medium-High (UX)
**What:** Remaining items from the 2026-07 UX audit (63 verified findings; quick wins shipped separately):
- Flow-aware popup: Protect → Ask AI → Restore stepper, post-copy next-step state
- Session activity view (list Mode A/B/C sanitize events; tag mapping batches with a source field)
- Mode B: in-page toast with Undo + re-intercept snooze, per-site exceptions, real chrome.notifications (permission is declared but unused)
- Dark theme across popup/settings/onboarding via shared tokens.css
- Mode A undo/bypass for false positives; sanitized-text preview pane
- Onboarding v2: live sandbox instead of slides
**Why:** Audit confirmed the round-trip is undiscoverable and automatic modes are invisible; these close the loop.
**Added:** 2026-07-08 via design review (see review artifact)

## DONE: ReDoS hardening for L1 pattern matching (was: regex timeout wrapper)
**Resolved:** 2026-07-10 — a same-thread timeout is impossible (JS regex execution
is synchronous and uninterruptible) and a Web Worker breaks the paste handler's
synchronous-preventDefault requirement. Solved at the root instead:
- Every L1 regex now uses bounded quantifiers and unambiguous classes (linear
  matching). The email pattern was genuinely quadratic — a 100KB crafted input
  took 5.3s (old) vs 16ms (fixed); see `patterns/email.ts`.
- `scanL1` logs (never silently skips) slow or throwing patterns; input is
  never truncated — for a PII guard, scanning less fails open.
- Adversarial regression tests in `test/scanner-redos.test.ts` pin the
  linear-time behavior.
**Added:** 2026-03-25 via /plan-eng-review

## DONE: Test content script rendering against AI site CSP headers
**Resolved:** 2026-07-13 — end-to-end verified on all three sites with a real
(isTrusted) Ctrl+V paste of sample PII into each site's own composer/input,
via `extension/e2e/csp-toast-verify.mjs` (Playwright + loaded extension). The
script derives its site list from the manifest's Mode A matches (a new host
can't silently skip verification) and its PASS gate enforces: toast in DOM,
injected styles applied AND visible in viewport, placeholders inserted, none
of the planted PII literals present, no extension-attributable CSP violation,
and a native (non-synthetic) site editable.
- **chatgpt.com, claude.ai, gemini.google.com: all pass.** No fallback
  (badge/notification) needed.
- CSP does NOT block the toast anywhere: content scripts run in Chrome's
  isolated world, which is exempt from the page CSP — even Gemini's
  `require-trusted-types-for 'script'` doesn't affect our `innerHTML` use.
- The real failures found were OURS, not CSP (all fixed in
  `content-script.ts`): writing `selectionStart/End` on `input[type=email]`
  throws `InvalidStateError` (sanitized text landed but input event + toast
  were skipped — zero feedback on Claude's login field); the direct `.value`
  splice ignored the user's visual selection on selection-less inputs AND was
  deduped by React's value tracker (site state never saw the sanitized text).
  Insertion now goes through `document.execCommand('insertText')` first
  (real caret/selection, native input event, undo stack), verified by
  placeholder presence, with a prototype-setter splice fallback; fields that
  reject placeholders (`type=number`) keep their old value and the toast says
  "Blocked a paste" instead of falsely claiming insertion.
**Added:** 2026-03-25 via /plan-eng-review

## DONE: Design doc — eng review decisions + full design system (was two TODOs)
**Resolved:** 2026-07-13 — created `DESIGN.md` in-repo covering both halves:
- Architecture decisions from eng review: parallel detection + priority merge,
  Presidio native API + FastAPI gateway sidecar, three modes,
  chrome.storage.session reversible tokenization, phased L1/L2 shipping,
  pattern registry, plus the later invariants (synchronous interception,
  fail-closed scanning, execCommand-first insertion with honest toast).
- Design system: token tables (light+dark, from `tokens.css` as canonical),
  severity color+shape system, type/space/radius/elevation/motion scales,
  component specs (toast with its executeScript self-containment constraint,
  popup stepper/activity/restore, settings, onboarding), interaction &
  accessibility rules, copy rules, U of T brand usage.
**Note:** merged the former "Update design doc with eng review decisions" and
"Create DESIGN.md via /design-consultation" TODOs (both 2026-03-25) — one
document serves both.
**Added:** 2026-03-25 via /plan-design-review
