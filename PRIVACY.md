# Privacy Policy — U of T Prompt Sanitizer

**Last updated:** 2026-03-25

## Overview

The U of T Prompt Sanitizer is a browser extension built for the University of Toronto community. It detects and removes personally identifiable information (PII) from text before users share it with public AI tools.

## Data Collection

### What we DO NOT collect
- We do not collect, store, or transmit any text you scan
- We do not collect browsing history or page content
- We do not track which AI tools you use
- We do not collect personal information, names, or identifiers
- We do not use cookies or tracking pixels
- We do not share any data with third parties

### Layer 1 (browser-side detection)
All Layer 1 PII detection runs **entirely in your browser**. Text is scanned using pattern matching (regex) within the extension's local process. No text ever leaves your device. No network requests are made during scanning.

### Layer 2 (on-premises NER — future)
When available, Layer 2 sends text to a Microsoft Presidio server hosted on the University of Toronto's ITS Private Cloud infrastructure. This data:
- Never leaves U of T's network boundary
- Is processed in memory and not stored
- Is not logged or retained after the scan completes
- Is only sent when the user explicitly enables "Deep Scan"

### Reversible tokenization
Token mappings (the link between placeholders like [PERSON_1] and original values) are stored in your browser's sessionStorage. This data:
- Never leaves your device
- Is automatically cleared when you close the browser tab
- Is not accessible to websites or other extensions

## Permissions

The extension requests these browser permissions:

| Permission | Why |
|-----------|-----|
| `storage` | Save your mode preference (A/B/C) and settings locally |
| `clipboardRead` | Read clipboard contents for the Ctrl+Shift+S sanitize shortcut |
| `clipboardWrite` | Write sanitized text to your clipboard after scanning |
| `notifications` | Show system notifications when PII is detected (if available) |
| `scripting` | Inject toast notifications and read selected text on web pages |
| `activeTab` | Access the currently active tab for the keyboard shortcut |
| `offscreen` | Create a temporary background page for clipboard operations |
| Host permissions (AI sites) | Run paste-interception on ChatGPT, Claude, and Gemini |
| `<all_urls>` | Run copy-interception when Mode B (Always Protected) is enabled |

## Data flow diagram

```
┌─────────────────────────────────────────┐
│  Your Browser (everything stays here)    │
│                                          │
│  Text → L1 Regex Scan → Results          │
│           (no network)                   │
│                                          │
│  Token mappings → sessionStorage         │
│           (cleared on tab close)         │
│                                          │
│  Settings → chrome.storage.local         │
│           (never synced, never uploaded)  │
└─────────────────────────────────────────┘
          │
          │ ONLY if Deep Scan enabled (future)
          │ ONLY to U of T Private Cloud
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
