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

## TODO: Test content script rendering against AI site CSP headers
**Priority:** High (gating for Mode A)
**What:** Verify that toast notifications and inline DOM elements injected by the content script actually render on ChatGPT (chatgpt.com), Claude (claude.ai), and Gemini (gemini.google.com).
**Why:** These sites may have Content Security Policy headers that block injected CSS or DOM elements. If CSP blocks our toast, Mode A (paste-intercept + toast notification) silently fails — the user gets no feedback. Fallback needed: extension badge count or popup notification instead of inline toast.
**How:** Load the extension on each target site, trigger a paste with PII, verify toast renders. Check CSP headers with DevTools. Document which sites work and which need fallbacks.
**Depends on:** Extension scaffold + Mode A content script implementation.
**Added:** 2026-03-25 via /plan-eng-review

## TODO: Update design doc with eng review decisions
**Priority:** Medium
**What:** Update the project design doc to reflect architectural decisions made during eng review. (The original design doc lived in external tooling that is no longer present — recreate it in-repo, e.g. `DESIGN.md`.)
**Why:** The design doc is the source of truth for the architecture. It currently reflects the pre-review architecture.
**Changes needed:**
- Sequential pipeline → parallel detection with priority-based merge
- "FastAPI or Flask" → Presidio native API + FastAPI gateway sidecar
- Popup-only UX → three configurable modes (A: paste-intercept on AI sites, B: copy-intercept everywhere, C: manual popup + hotkey)
- Add reversible tokenization with chrome.storage.session (originally sessionStorage; replaced for cross-context restore — see PRIVACY.md)
- Add phased shipping strategy (L1 first, L2 behind feature flag)
- Add pattern registry architecture (one file per pattern)
**Depends on:** Nothing — can be done immediately.
**Added:** 2026-03-25 via /plan-eng-review

## TODO: Create DESIGN.md via /design-consultation
**Priority:** Medium
**What:** Run `/design-consultation` to create a full DESIGN.md with component library, spacing scale, interaction patterns, and U of T brand integration.
**Why:** The design tokens from the plan-design-review are minimum-viable. A full design system prevents implementer guessing and ensures consistency across popup, toast, settings, and onboarding.
**Context:** Current tokens: U of T blue (#002A5C), system-ui font, severity color system (red/yellow/blue), 400px popup width. DESIGN.md would formalize these plus define component specs (toast, detection card, severity badge, tab navigation).
**Depends on:** Nothing — can be done before or after implementation.
**Added:** 2026-03-25 via /plan-design-review
