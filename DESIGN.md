# DESIGN.md — U of T Prompt Sanitizer

Source of truth for the product's architecture decisions and design system.
Code is the implementation; when this document and the code disagree, fix one
of them in the same change (see `CLAUDE.md` doc-sync rule).

- Design tokens live in `extension/src/shared/tokens.css` (canonical values).
- Placeholder format lives in `extension/src/tokenizer/index.ts`
  (`PLACEHOLDER_RE` is the canonical regex; `e2e/csp-toast-verify.mjs` keeps a
  documented literal copy).
- Toast host contract (`[data-ps-toast-host]`, closed shadow root, inline
  `!important` layout lock) is defined in `extension/src/ui/toast.ts`; the e2e
  harness asserts the host (it cannot reach the closed shadow content).

## 1. Product shape

A Chrome MV3 extension (TypeScript, esbuild, vitest) plus an optional local
FastAPI/Presidio/spaCy backend. It detects and reversibly tokenizes sensitive
information before it reaches AI chat sites, and restores real values from the
AI's reply afterwards.

The core user loop is **Protect → Ask AI → Restore**:

1. **Protect** — PII in text is replaced with tagged placeholders
   (`[EMAIL_1~KQXR]`) before it leaves the user's control.
2. **Ask AI** — the sanitized text goes to ChatGPT / Claude / Gemini; the AI
   answers in terms of placeholders.
3. **Restore** — pasting the reply into the popup's Restore step swaps
   placeholders back to the original values (mappings never leave the
   browser).

### Modes

| Mode | Trigger | Where | Notes |
|---|---|---|---|
| A — AI-site guard | paste event | chatgpt.com, chat.openai.com, claude.ai, gemini.google.com | Default on. Intercepts only when L1 finds PII; clean pastes stay native. |
| B — copy guard | copy event | all sites | Sanitizes the clipboard copy. Toast offers Undo (restore raw + snooze re-interception of *that exact text* for 30s). |
| C — manual | popup scanner + Ctrl+Shift+S | anywhere | The only flows that run L2 (Deep Scan) — async is safe here. Shortcut toast offers Undo (no snooze — the shortcut is explicit). |

## 2. Architecture decisions (eng-review outcomes)

These supersede the original pre-review design:

- **Parallel detection with priority-based merge**, not a sequential pipeline.
  Every L1 pattern is a self-contained file in
  `extension/src/scanner/patterns/` registered in `registry.ts`; results merge
  via `mergeDetections` (sorted-frontier, O(n log n) in detection count) with
  type-priority → confidence → layer tiebreaks.
- **Presidio native API + FastAPI gateway sidecar** (`backend/`), not
  "FastAPI or Flask reimplementing detection". The backend is optional; the
  extension is fully functional on L1 alone.
- **Three configurable modes** (table above), not popup-only UX.
- **Reversible tokenization** backed by `chrome.storage.session`
  (`tokenizer/mapping-store.ts`): batch-per-key (`psmap_<ts>_<rand>`),
  service-worker-routed writes with `{ok}` acks, 64-batch oldest-first
  eviction that never evicts the just-written key, 32-batch in-memory
  fallback. Chosen over `sessionStorage` for cross-context restore — see
  `PRIVACY.md` for the user-facing semantics.
- **Placeholders are tagged per batch** — `[LABEL_N~XXXX]`, uppercase-only
  4-char tag so no L1 pattern can re-detect a placeholder as PII, and so
  placeholders from independent sanitize operations can never collide on
  restore.
- **Phased shipping**: L1 (regex, synchronous, in-extension) always on;
  L2 (backend NER) behind an explicit Deep Scan opt-in with plain-language
  consent in settings.
- **Synchronous interception invariant**: paste/copy handlers must cancel and
  replace content inside the event's dispatch phase. Nothing async (and no
  same-thread regex timeout) is allowed on that path — protection against
  pathological inputs comes from the linear-time regex discipline documented
  in `scanner/index.ts` and pinned by `test/scanner-redos.test.ts`.
- **Fail closed, loudly**: input is never truncated and patterns are never
  silently skipped; a throwing pattern is logged and skipped so one recognizer
  can't disable the rest. For a PII guard, scanning less fails open.
- **Field insertion goes through `document.execCommand('insertText')` first**
  (real caret/visual selection, native input event that React's value tracker
  accepts, undo stack preserved), verified by placeholder presence, with a
  prototype-setter splice fallback. Fields that reject placeholder text
  (`type=number`) keep their old value and the toast reports "Blocked a
  paste" — feedback must never claim an insertion that didn't happen.

## 3. Design tokens

Canonical values in `extension/src/shared/tokens.css` — linked before each
surface's own stylesheet, which must not re-declare them. Dark theme follows
`prefers-color-scheme`; both themes are first-class.

### Color

| Token | Light | Dark | Role |
|---|---|---|---|
| `--uoft-blue` | `#002A5C` | `#002A5C` | Brand plates (headers, icon field). Stays brand navy in both themes. |
| `--uoft-blue-light` | `#003D7A` | `#123C6E` | Hover/secondary brand surfaces. |
| `--uoft-accent` | `#002A5C` | `#8FB6EA` | Text/interactive accent readable on the current surface. Use this for links, active states, focus — never raw navy on dark. |
| `--surface` / `--surface-secondary` | `#FFFFFF` / `#F8F9FA` | `#14202F` / `#1C2A3D` | Page and card backgrounds. |
| `--text-primary` / `--text-secondary` | `#1A1A2E` / `#5C6675` | `#E8EEF7` / `#A5B2C5` | Body / supporting text. |
| `--border` | `#E0E0E0` | `#33445C` | Hairlines, dividers, input borders. |
| `--success` (+`-bg`) | `#1E7E34` | `#5BC492` | Confirmation states. |

**Rule:** components style themselves through tokens only. Never hard-code a
hex in a surface stylesheet; the one sanctioned exception is the on-page toast
(section 4), which cannot rely on extension stylesheets.

### Severity system (color + shape)

Severity is never encoded by color alone — each level pairs a color with a
distinct dot shape so it survives color-vision deficiency and grayscale:

| Level | Light / Dark color | Shape | Meaning |
|---|---|---|---|
| high | `#DC3545` / `#F28B82` | filled circle | Identity-critical (SIN, credit card, U of T email…) |
| medium | `#856404` / `#E0BB5C` | filled square (1.5px radius) | Contact/identifier (generic email, phone…) |
| low | `#0C5460` / `#93A5BD` | outlined circle | Contextual (usernames, URLs…) |

Each severity also has a `-bg` token for chips/cards.

### Type

- Font: `system-ui, -apple-system, sans-serif` on every surface (including the
  injected toast). No webfonts — extension surfaces must render instantly and
  the toast cannot load external resources (CSP).
- Scale (popup reference): 18px page title · 14px section head · 13px body ·
  12px secondary · 11px captions/labels · 10.5px fine print.
- Weights: 600 for headings/emphasis (dominant), 400 body. The toast headline
  uses 650.
- Digits that align in columns (counts, timestamps) use
  `font-variant-numeric: tabular-nums`.

### Space, radius, elevation

- Spacing steps: 4 / 6 / 8 / 10 / 12px — lay out sibling groups with
  flex/grid `gap`, not per-element margins.
- Radius: 6px standard (cards, buttons, inputs); 10px for the toast card;
  round for dots/avatars.
- Popup width: fixed 400px.
- Elevation (toast): `0 1px 2px rgba(16,24,40,.08), 0 10px 32px rgba(16,24,40,.12)`
  — one soft contact shadow + one ambient. Dark theme deepens both.

### Motion

- One entrance animation per surface event (e.g. toast slide-up 0.25s
  ease-out). No scattered micro-animations.
- Every animation and transition is disabled under
  `prefers-reduced-motion: reduce`.

## 4. Components

### On-page toast (`ui/toast.ts`)

The only UI injected into third-party pages, shared by Mode A (direct call)
and Mode C (`chrome.scripting.executeScript`).

- **Hard constraint:** the render function is serialized with `toString()`
  for `executeScript`, so it must stay fully self-contained — no imports, no
  module-scope references.
- **Isolation:** the card renders inside a **closed shadow root** on a host
  element (`[data-ps-toast-host]`) whose layout/visibility (`position`,
  `z-index`, `display`, `visibility`, `opacity`, `pointer-events`) are set
  inline with `!important`. What this closes, precisely:
  - **Forced undo / read / reach — fully closed.** The closed root gives page
    scripts no handle to the card or its Undo button (can't read, restyle,
    focus, or click them), and the Undo handler also requires `isTrusted`. A
    hostile page cannot force an undo or read the toast.
  - **Stylesheet hiding of the host — closed.** Inline `!important` outranks any
    page stylesheet rule targeting the host.
  - **Not fully closable (inherent to in-page UI):** a hostile page's own
    JavaScript can remove/restyle this light-DOM host, and ancestor compositing
    CSS (`body`/`html` `opacity`/`filter`/`transform`/`display`) can hide any
    fixed child. These only **suppress** the notice — the clipboard/field is
    already sanitized so content stays safe. The **toolbar badge and popup**
    (surfaces the page can't touch) are the tamper-proof fallback; a future
    `chrome.notifications` path (see TODOS) would be a fully out-of-page notice.
  - Styles live in a `<style>` inside the shadow root (no shared-`<head>`
    element to pre-empt). If `attachShadow` is unavailable (non-HTML XML/SVG
    viewer documents), the card degrades to light DOM so the notice still
    appears; the host root falls back to `documentElement` when `body` is null.
- Host fixed bottom-right, `z-index: 2147483647`; card max-width 330px.
- Content: shield icon + headline, up to 3 severity-dotted type labels
  (`+N more` beyond that), footer with the next step. **Never raw PII values —
  labels only** (values would be echoed into the page DOM).
- Honest copy: "Protected N items in your paste" only when placeholders
  verifiably landed; "Blocked a paste with N sensitive items" when the field
  rejected them.
- Optional Undo action (`payload.undoText`): restores the original text to
  the clipboard on a **real** user activation only (`isTrusted` — page
  scripts must not be able to switch protection off), then reports "Original
  restored ✓". The button is disabled synchronously on click (no double
  restore), the original is held in memory only and never rendered, and the
  snooze is armed only if the toast is still live (`isConnected`). Offered
  only where `navigator.clipboard.writeText` exists — omitted on insecure
  (http) pages rather than falling back to `execCommand('copy')`, which the
  Mode B copy interceptor would re-sanitize. Direct (same-world) callers may
  pass an `onUndone` hook — Mode B uses it to snooze re-interception of the
  **exact undone selection** for 30s (not tab-global — unrelated copies stay
  protected) and to clear the toolbar badge; the executeScript path can't
  pass callbacks, so Mode C gets clipboard restore only.
- `role="alert"` (the one live-region pattern reliably announced for a node
  inserted already-populated). Close button with `aria-label`. 8s auto-dismiss
  paused on hover/focus (reset-then-start timer); Undo failure (focus loss)
  relabels the button with the retry instruction instead of failing silently.
- Verified rendering on all three AI sites despite their CSPs (isolated-world
  exemption) — `e2e/csp-toast-verify.mjs` gates this.

### Popup (`popup/`)

- 400px; three-step flow stepper (Protect → Ask AI → Restore) as tabs with
  the ARIA tabs pattern: roving tabindex, `aria-posinset`/`aria-setsize`,
  arrow-key navigation.
- Scanner: textarea → detection cards (type label, severity chip, explanation,
  Keep toggle) → sanitized preview with placeholder tokens → copy button that
  advances the flow state (`copiedKeys` downgrade on L2 merge).
- Session activity panel: batch summaries (source · site · time · count) from
  `loadBatchSummaries()`, newest first, plus a restore-event counter. Sources
  display as: paste → "AI-site guard", copy → "Copy guard", shortcut →
  "Shortcut", popup → "Popup".
- Restore: paste area + result live region (always present in DOM, populated
  on action) with failure diagnosis (placeholders-but-no-mappings vs
  no-placeholders).
- Empty states explain the next action, not just "nothing here".

### Settings (`settings/`)

- Mode cards with plain-language names + disclosure rows; Deep Scan consent is
  explicit, plain-language, and revocable; permission requests that get
  rejected restore the toggle and say "not saved".
- Field rows: label left, control right, description under label. Toggles are
  keyboard-focusable with visible focus.

### Onboarding (`onboarding/`)

Three slides (v2 direction: live sandbox — see TODOS). Uses the same tokens;
no bespoke colors.

## 5. Interaction and accessibility rules

- Every interactive element: visible `:focus-visible` state using
  `--uoft-accent`.
- `[hidden] { display: none !important; }` in every surface stylesheet —
  author `display:flex` must never resurrect hidden elements.
- Live feedback: `role="alert"` for one-shot injected notices; polite live
  regions pre-exist in the DOM for in-surface results.
- Severity is shape+color (section 3); state is never color-only.
- Copy rules: name user actions ("Copy safe version", "Restore"), state
  outcomes plainly ("Copied ✓", "not saved"), never expose internals
  ("mapping batch" → "session"). Toast/footer copy promises only what the
  product verifiably did.
- Language: UI copy and docs are English (see `CLAUDE.md` for the
  conversation-language rule).

## 6. Brand

- U of T navy `#002A5C` is the brand anchor: plates, header bars, the icon's
  shield field. It is a *surface* color, not a text accent — on dark surfaces
  use `--uoft-accent` (`#8FB6EA`) for anything that must be readable.
- The icon is a navy rounded square with the U of T shield silhouette in
  `#E8ECF2` (see `icons/`; the toast embeds the same shield inline).
- Tone: institutional-calm, protective, non-alarmist. Warnings inform and
  offer the next step; they don't scold.
