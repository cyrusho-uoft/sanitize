# Privacy Policy — U of T Prompt Sanitizer

**Last updated:** 2026-07-05

## Overview

The U of T Prompt Sanitizer is a browser extension built for the University of Toronto community. It detects and removes personally identifiable information (PII) from text before users share it with public AI tools.

## Data Collection

### What we DO NOT collect
- We do not collect, store, or transmit any text you scan
- We do not transmit or persistently store browsing history or page content
- We do not track which AI tools you use, beyond a temporary in-memory session activity list (event source, site hostname, timestamp, item count) that clears when the browser closes
- We do not collect personal information, names, or identifiers
- We do not use cookies or tracking pixels
- We do not share any data with third parties

### Layer 1 (browser-side detection)
All Layer 1 PII detection runs **entirely in your browser**. Text is scanned using pattern matching (regex) within the extension's local process. No text ever leaves your device. No network requests are made during scanning.

### Layer 2 (on-premises NER — opt-in)
Layer 2 ("Deep Scan") is **off by default**. When you enable it in Settings, text is sent to a Microsoft Presidio server hosted on the University of Toronto's ITS Private Cloud infrastructure (the server address is configurable in Settings; it defaults to a local development server). This data:
- Is only sent when you explicitly enable "Deep Scan"; with Deep Scan off, no text ever leaves your device
- Never leaves U of T's network boundary (when pointed at the U of T Private Cloud gateway)
- Is processed in memory and not stored
- Is not logged or retained after the scan completes
- Carries only the text you are scanning — no identifiers, browsing history, or account data

### Reversible tokenization
Token mappings (the link between placeholders like [PERSON_1~XKQR] and original values) are stored in `chrome.storage.session` — the extension's in-memory session storage. This data:
- Never leaves your device and is never written to disk
- Is automatically cleared when you close the browser (and when the extension is updated, reloaded, or disabled — Restore does not survive an extension update)
- Is not accessible to websites or other extensions
- Is shared only between the extension's own components, so you can sanitize in one tab and restore from the popup later in the same browser session
- Is capped at the most recent sanitize operations; the oldest mappings are discarded first if the cap is reached
- Powers the popup's session activity view, which records only the event source (paste/copy/shortcut/popup), the site's hostname, a timestamp, an item count, and a running count of restore actions this session — never the text or the detected values

## Permissions

The extension requests these browser permissions:

| Permission | Why |
|-----------|-----|
| `storage` | Save your mode preference (A/B/C) and settings locally, and hold token mappings in the extension's in-memory session storage (`chrome.storage.session`) until the browser closes |
| `clipboardRead` | Declared for a planned clipboard fallback; the Ctrl+Shift+S shortcut currently reads your selected text, not the clipboard |
| `clipboardWrite` | Write sanitized text to your clipboard after scanning |
| `notifications` | Declared for planned system notifications; feedback currently uses on-page banners and the toolbar badge |
| `scripting` | Inject toast notifications and read selected text on web pages |
| `activeTab` | Access the currently active tab for the keyboard shortcut |
| `offscreen` | Create a temporary background page for clipboard operations |
| Host permissions (AI sites) | Run paste-interception on ChatGPT, Claude, and Gemini |
| Host permissions (L2 backend) | Send text to the Deep Scan gateway (default `http://localhost:8000`) — only used while Deep Scan is enabled. A non-localhost gateway is requested at runtime (you'll be prompted) and not granted until you approve it. |
| `<all_urls>` | Run copy-interception when Mode B (Copy guard — everywhere) is enabled |

## Data flow diagram

```
┌─────────────────────────────────────────┐
│  Your Browser (everything stays here)    │
│                                          │
│  Text → L1 Regex Scan → Results          │
│           (no network)                   │
│                                          │
│  Token mappings → chrome.storage.session │
│      (in-memory, cleared on browser close)│
│                                          │
│  Settings → chrome.storage.local         │
│           (never synced, never uploaded)  │
└─────────────────────────────────────────┘
          │
          │ ONLY if Deep Scan enabled (off by default)
          │ ONLY to the configured gateway (default: U of T Private Cloud)
          ▼
┌─────────────────────────────────────────┐
│  U of T ITS Private Cloud                │
│  (on-premises, never leaves U of T)      │
│                                          │
│  Text → Presidio NER → Results           │
│  (processed in memory, not stored)       │
└─────────────────────────────────────────┘
```

## Open source

This extension is open source. You can review all code at:
https://github.com/cyrusho-uoft/sanitize

## Contact

For questions about this privacy policy or the extension, contact the University of Toronto AI Task Force.

## Changes

We will update this privacy policy as new features are added. Material changes will be noted in the extension's changelog.
