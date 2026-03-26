# TODOS

## TODO: Regex timeout wrapper for L1 pattern matching
**Priority:** High (security)
**What:** Add a timeout wrapper around each L1 regex pattern execution to prevent catastrophic backtracking from freezing the browser tab.
**Why:** A crafted input with nested repetitions can cause JavaScript regex to run indefinitely. This is a denial-of-service vulnerability in the browser's main thread.
**How:** Use `performance.now()` time-bounded execution or run patterns in a Web Worker with a 100ms timeout per pattern. If a pattern exceeds the timeout, skip it and log the event.
**Depends on:** L1 pattern registry implementation.
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
**What:** Update the design doc at `~/.gstack/projects/gstack/cyrus-unknown-design-20260324-164344.md` to reflect architectural decisions made during eng review.
**Why:** The design doc is the source of truth for downstream skills (/plan-design-review, /ship). It currently reflects the pre-review architecture.
**Changes needed:**
- Sequential pipeline → parallel detection with priority-based merge
- "FastAPI or Flask" → Presidio native API + FastAPI gateway sidecar
- Popup-only UX → three configurable modes (A: paste-intercept on AI sites, B: copy-intercept everywhere, C: manual popup + hotkey)
- Add reversible tokenization with sessionStorage
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
