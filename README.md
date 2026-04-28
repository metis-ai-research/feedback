# @metis-ai-research/feedback

Drop-in customer feedback widget for React apps. Submits bug reports, general feedback, and feature requests directly to Linear (or any adapter you write).

- Floating widget UI with type selector, title, description, optional screenshot
- Server-side proxy so your Linear API key never touches the browser
- Honeypot + IP rate limit baked in
- Pluggable adapters — Linear ships by default; bring your own for GitHub Issues, Slack, Plain, etc.
- Auth-aware: pass the current user and their context flows through to the ticket

---

## Install

```bash
npm install @metis-ai-research/feedback
```

`react` and `react-dom` are peer dependencies. Tailwind CSS is required (the widget uses Tailwind classes).

If you're using Tailwind v3, add the package's path to `content`:

```ts
// tailwind.config.ts
content: [
  './app/**/*.{ts,tsx}',
  './node_modules/@metis-ai-research/feedback/dist/**/*.{js,cjs}',
]
```

---

## Quick start (Next.js App Router)

### 1. Server route

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from '@metis-ai-research/feedback/server'
import { linearAdapter } from '@metis-ai-research/feedback/adapters/linear'

export const POST = createFeedbackHandler({
  adapter: linearAdapter({
    apiKey: process.env.LINEAR_API_KEY!,
    teamId: process.env.LINEAR_TEAM_ID!,
    // Optional: route by feedback type
    labelMap: {
      bug: [process.env.LINEAR_LABEL_BUG!],
      feedback: [process.env.LINEAR_LABEL_FEEDBACK!],
      feature: [process.env.LINEAR_LABEL_FEATURE!],
    },
  }),
  // Defaults: 10 requests / 60s per IP. Pass `false` to disable.
  rateLimit: { maxPerWindow: 10, windowMs: 60_000 },
})
```

### 2. Client widget

```tsx
// app/layout.tsx (or any client-rendered place)
import { FeedbackWidget } from '@metis-ai-research/feedback'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <FeedbackWidget
          endpoint="/api/feedback"
          user={{ id: session?.user.id, email: session?.user.email, name: session?.user.name }}
          appVersion="1.0.0"
        />
      </body>
    </html>
  )
}
```

That's it. The widget appears as a floating button bottom-right. Click → modal → submit → ticket lands in Linear.

> Note: client-supplied `user` fields are not authoritative. If you have auth, override them server-side — see [Securing user context](#securing-user-context).

---

## Getting your Linear values

You need three IDs to wire this up: an API key, a `teamId`, and (optionally) a `projectId` and label IDs.

### API key

Create one at [linear.app/settings/api](https://linear.app/settings/api) → "Create personal API key". The key looks like `lin_api_...`. Treat it like a password — server-side env vars only, never in client code or git.

### `teamId` is a UUID, not the team key

This is the #1 source of 400s. The `teamId` field expects the team's **UUID** (e.g. `9cfb482a-...`), not the human-readable key like `ENG` you see in URLs (`linear.app/your-org/team/ENG/...`). Passing the key will fail.

List your team UUIDs:

```bash
curl -s https://api.linear.app/graphql \
  -H "Authorization: lin_api_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id key name } } }"}'
```

The `id` field in each node is what you want.

### `projectId` (optional)

```bash
curl -s https://api.linear.app/graphql \
  -H "Authorization: lin_api_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ projects { nodes { id name } } }"}'
```

### Label IDs (optional)

Labels are scoped to a team. Query labels for the team you'll be filing into:

```bash
curl -s https://api.linear.app/graphql \
  -H "Authorization: lin_api_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ team(id: \"YOUR_TEAM_UUID\") { labels { nodes { id name } } } }"}'
```

Use these IDs in `labelMap`. Labels from a different team will silently not apply (see [Troubleshooting](#troubleshooting)).

### `.env.example`

```bash
LINEAR_API_KEY=
LINEAR_TEAM_ID=
LINEAR_PROJECT_ID=          # optional
LINEAR_LABEL_BUG=           # optional
LINEAR_LABEL_FEEDBACK=      # optional
LINEAR_LABEL_FEATURE=       # optional
```

---

## Configuration

### `<FeedbackWidget />` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `endpoint` | `string` | required | Path to your server route (e.g. `/api/feedback`) |
| `user` | `{ id?, email?, name? }` | undefined | Auth-aware context — included on the ticket |
| `appVersion` | `string` | undefined | Useful for correlating bugs to deploys |
| `metadata` | `Record<string, unknown>` | undefined | Free-form per-app context |
| `position` | `'bottom-right' \| 'bottom-left' \| 'inline'` | `'bottom-right'` | Where the trigger lives |
| `triggerLabel` | `string` | `'Feedback'` | Trigger button text |
| `defaultType` | `'bug' \| 'feedback' \| 'feature'` | `'feedback'` | Pre-selected type |
| `onSuccess` | `(result) => void` | undefined | Callback after successful submission |

### `linearAdapter` options

| Option | Type | Notes |
|---|---|---|
| `apiKey` | `string` | Personal API key from Linear settings |
| `teamId` | `string` | UUID of the Linear team that should receive issues |
| `projectId` | `string` (optional) | Pin all issues to a specific project |
| `labelMap` | `Partial<Record<FeedbackType, string[]>>` | Map types → Linear label IDs |
| `defaultPriority` | `0 \| 1 \| 2 \| 3 \| 4` | 0 = none, 1 = urgent, 4 = low |
| `titlePrefix` | `Partial<Record<FeedbackType, string>> \| false` | Override default `[BUG]` / `[FEEDBACK]` / `[FEATURE]` prefixes, or `false` to disable |

### `createFeedbackHandler` options

| Option | Type | Notes |
|---|---|---|
| `adapter` | `FeedbackAdapter` | Required. The Linear adapter or a custom one |
| `rateLimit` | `{ maxPerWindow, windowMs } \| false` | Default `{ 10, 60_000 }`. `false` disables. |
| `enrichPayload` | `(payload, request) => Promise<Partial<FeedbackPayload>>` | Server-side hook to add user IDs, etc. from auth |

### What gets sent to Linear

Only the fields below are forwarded to the adapter. Nothing else leaves your app.

| Field | Source | Notes |
|---|---|---|
| `title` | user input | Required, max 200 chars |
| `description` | user input | Required, max 10,000 chars |
| `type` | user selection | `bug`, `feedback`, or `feature` |
| `screenshotDataUrl` | optional capture | Uploaded to Linear's CDN, embedded as a markdown image |
| `userContext.url` | `window.location.href` | Page the user submitted from |
| `userContext.userAgent` | `navigator.userAgent` | Browser/OS string |
| `userContext.viewport` | `window.innerWidth/Height` | Useful for repro |
| `userContext.appVersion` | `appVersion` prop | If you pass it |
| `userContext.userId` | `user.id` prop or `enrichPayload` | Override server-side for trust |
| `userContext.userEmail` | `user.email` prop or `enrichPayload` | Override server-side for trust |
| `userContext.userName` | `user.name` prop or `enrichPayload` | Override server-side for trust |
| `metadata` | `metadata` prop or `enrichPayload` | Free-form, rendered as a JSON block |

### Securing user context

The `user` prop on `<FeedbackWidget />` is sent from the browser, so a hostile or buggy client can lie about `user.id`, `user.email`, and `user.name`. If you have auth, do not trust those values — overwrite them server-side via `enrichPayload`. Returned partials are deep-merged onto the validated payload, so client-supplied fields (like `appVersion`) survive.

```ts
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

enrichPayload: async () => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return {}
  return { userContext: { userId: session.user.id, userEmail: session.user.email, userName: session.user.name } }
},
```

If `enrichPayload` throws, the handler logs and submits the un-enriched payload anyway — it never blocks user feedback on an auth lookup failure.

---

## Custom adapters

Implement the `FeedbackAdapter` interface:

```ts
import type { FeedbackAdapter, FeedbackPayload, FeedbackResult } from '@metis-ai-research/feedback/server'

export function githubAdapter(opts: { token: string; repo: string }): FeedbackAdapter {
  return {
    name: 'github',
    async submit(payload: FeedbackPayload): Promise<FeedbackResult> {
      const res = await fetch(`https://api.github.com/repos/${opts.repo}/issues`, { /* ... */ })
      // ...
      return { ok: true, ticketUrl: '...' }
    }
  }
}
```

Adapters must not throw on transport errors — return `{ ok: false, error }` instead. The handler maps both thrown errors and `ok: false` returns to a 502.

---

## Troubleshooting

**HTTP 500 with `linearAdapter: apiKey is required` (or `teamId is required`) in the server logs** — `LINEAR_API_KEY` or `LINEAR_TEAM_ID` is missing in the environment the route runs in. The adapter throws synchronously when constructed, so the route module fails to load and Next.js returns a 500. Set the env vars and redeploy.

**HTTP 400 from Linear (logged as `Linear API responded 400`)** — almost always a bad `teamId`. The most common cause is using the team key (`ENG`) instead of the UUID. Also check that `projectId` and any label IDs in `labelMap` are valid UUIDs.

**Submission succeeds but the ticket has no labels** — the label IDs in `labelMap` belong to a different team than `teamId`. Linear silently drops cross-team labels rather than erroring. Re-run the label query scoped to the right team UUID.

---

## Production checklist

- **Separate API keys per environment.** Create one Linear key for production and a different one for dev/staging, so you can revoke either without affecting the other.
- **Vercel: set env vars on Production scope only.** Leave Preview and Development empty. The feedback route on those deploys will fail to load (500 with `apiKey is required` in the logs) instead of polluting your real Linear team with test tickets.
- **Redeploy after env var changes.** Vercel (and most platforms) bind env vars at build time — existing builds keep their old values until you redeploy.

---

## License

MIT © Metis AI Research Inc.
