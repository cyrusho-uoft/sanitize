# TODOS

## TODO: Design-audit follow-ups (core + bets)
**Priority:** Medium-High (UX)
**What:** Remaining items from the 2026-07 UX audit (63 verified findings):
- Mode B: per-site exceptions; real chrome.notifications (permission is declared but unused)
- Mode A undo/bypass for false positives; sanitized-text preview pane
- Onboarding v2: live sandbox instead of slides
**Shipped:** flow-aware popup stepper + post-copy state, session activity view
with batch source tags, dark theme via shared tokens.css (2026-07-10, PRs
#23/#24); Mode B in-page toast with Undo + per-selection 30s re-intercept
snooze, Undo on the Mode C shortcut toast (2026-07-14 — see DESIGN.md toast
spec; Undo is isTrusted-gated so page scripts can't disarm protection).
**Why:** Audit confirmed the round-trip is undiscoverable and automatic modes are invisible; these close the loop.
**Added:** 2026-07-08 via design review (see review artifact)

## TODO: Mode B trust hardening — store poisoning (pre-existing)
**Priority:** Medium (security)
**Done so far (2026-07-14):** the toast now renders in a **closed shadow root**
on a host whose layout/visibility are locked inline with `!important`, so a
hostile page can no longer suppress, reposition, clickjack, read, or restyle
the notice or its Undo button (verified: a page throwing `display:none`/
`visibility:hidden`/`opacity:0`/`transform`/`clip-path` `!important` at every
guessable selector cannot hide the host; `host.shadowRoot === null` from the
page). This also removed the shared-`<head>` stylesheet that a page could
pre-empt.
**Still open:** the copy interceptor's `isTrusted` gate does NOT block a
hostile page from driving our handler — `document.execCommand('copy')` fires a
copy event with `isTrusted === true` even with no user gesture (verified live
in a Playwright probe, 2026-07-14). A page can select attacker-chosen text and
`execCommand('copy')` in a loop to mint mapping batches into the single
browser-wide `chrome.storage.session` store, evicting the user's real mappings
(64-batch cap) — a restore-DoS. (Requires Mode B on; local DoS only, no
exfiltration.)
**Possible fixes:** gate mapping persistence on a stronger signal than
`isTrusted` (e.g. correlate with a recent real `selectionchange`), or
rate-limit/cap per-origin batch writes so a flood can't evict legitimate
mappings.
**Also:** the popup activity view still counts an undone copy as a
"replacement this session" (mappings are intentionally kept, but the count
overstates what stayed protected) — record an undo marker on the batch to
correct the tally.
**Added:** 2026-07-14 via Mode B Undo adversarial review

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
