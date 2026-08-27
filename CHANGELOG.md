# Changelog

## 0.2.0 — One vocabulary, and a framework-free Metis OS client

**One vocabulary.** `FEEDBACK_CATEGORIES` is now the agreed set for every caller
and every backend: `bug`, `feature`, `feedback`, `question`, `payment`, `other`.
Four projects had grown four spellings of the same six ideas — `technical-issues`
in one, `bug` in another, `general-inquiries` and `general` for one meaning —
which made every new caller a bespoke integration and every mismatch a `400`
that surfaced only on the first real submission.

- `FeedbackCategory` is the type to use. **`FeedbackType` is now an alias for it**
  and widened from three values to six. Additive for anything that *sends* a
  value; a break only for code that exhaustively switches on the type or builds
  a total `Record` from it.
- `linearAdapter`'s `DEFAULT_PREFIX` covers all six, and is total on purpose:
  adding a seventh category should fail to compile until someone decides how its
  tickets are titled.
- The widget still offers three of the six. Offering a subset is expected and
  correct; inventing a key is not.

**New `./metis` entry point — framework-free.** `createMetisFeedbackClient()`
posts to Metis OS, which holds the Linear credential and decides where the ticket
goes. No React, no DOM, no Tailwind, so it imports cleanly from React Native as
well as the web; it needs only `fetch` and `AbortController`, and builds without
the `'use client'` banner.

It replaces four hand-rolled copies of the same twenty lines of `fetch`, which
had already drifted on category names, on whether the server's error string was
shown to users, and on whether a failed send cleared what the person had typed:

- Never surfaces the server's `error` — those are English telemetry markers, not
  UI. Copy is chosen by failure kind and overridable via `messages`, so a
  localized app stays localized.
- Never throws. A failure resolves to `{ ok: false, kind }` so the form can keep
  what was typed and offer a retry.
- Sends no routing field — no team, label or assignee — so a leaked public key
  cannot redirect a ticket anywhere. A test holds that.

## 0.1.1 — Documentation: Linear setup, troubleshooting, production checklist
