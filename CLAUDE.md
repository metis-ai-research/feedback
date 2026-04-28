# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@metis/feedback` is a publishable React + Node library (npm package), not an app. It ships a floating feedback widget plus a server-side handler that proxies submissions to Linear (or a custom adapter). Output goes to `dist/` via tsup; consumers install the published package.

## Commands

- `npm run build` — tsup build of all entries + Tailwind CSS pipeline (see "CSS pipeline" below).
- `npm run dev` — tsup in watch mode.
- `npm test` — vitest run (one-shot, not watch). The test entry is `vitest run`, so to watch use `npx vitest`.
- `npm run typecheck` — `tsc --noEmit`. Tests are excluded from `tsconfig.json`'s `include`, so typecheck only covers `src/`.
- Single test file: `npx vitest run tests/handler.test.ts`. Single test name: `npx vitest run -t "rate-limits"`.
- `npm run prepare` runs `build`, so `npm install` in this repo triggers a full build.

## Architecture

Three independently-published entry points share the same `src/shared/types.ts` contract (`FeedbackPayload`, `FeedbackResult`, `FeedbackType`, `UserContext`):

- **`@metis/feedback`** (`src/index.ts`) — client-only. Exports `FeedbackWidget`. Built with a `'use client'` banner so RSC consumers can drop it into a server tree.
- **`@metis/feedback/server`** (`src/server.ts`) — `createFeedbackHandler` returns a `(req: Request) => Promise<Response>` suitable for Next.js App Router or any Web-API runtime. Built **without** the `'use client'` banner.
- **`@metis/feedback/adapters/linear`** (`src/adapters/linear.ts`) — the default Linear adapter. Other adapters (GitHub, Slack, etc.) are not shipped; consumers implement the `FeedbackAdapter` interface (`src/adapters/types.ts`).

The build splits into two tsup configs in `tsup.config.ts` precisely because the client entry needs the `'use client'` banner and the server/adapter entries must not have it. If you add a new entry, put it in the matching config block.

### Request flow

1. `FeedbackWidget` (client) collects the form, optionally captures a screenshot via lazy-imported `modern-screenshot` (browser-only), and POSTs JSON to the configured `endpoint`.
2. `createFeedbackHandler` (server) parses with a zod schema (`PayloadSchema` in `src/server/handler.ts`), enforces an in-memory IP rate limit, drops honeypot-filled requests with a fake 200, runs optional `enrichPayload` (server-trusted overrides like authoritative `userId`), then calls `adapter.submit(payload)`.
3. `linearAdapter` formats title/description, optionally uploads the screenshot through Linear's `fileUpload` mutation (presigned URL → PUT bytes → embed `assetUrl` as markdown image), then creates the issue via the `issueCreate` GraphQL mutation.

### Contracts to preserve

- **`FeedbackAdapter.submit` MUST NOT throw on transport errors** — return `{ ok: false, error }` instead. The handler maps thrown errors to 502 and `ok:false` returns to 502 as well; both paths log to `console.error` with the adapter name. Documented in `src/adapters/types.ts`.
- **Linear auth header is the raw API key, NOT `Bearer <key>`.** Easy to "fix" wrongly. Comment lives at the top of `src/adapters/linear.ts`.
- **Screenshot upload failure must not block issue creation.** If the Linear `fileUpload` chain fails at any step, the adapter still creates the issue without the screenshot. Don't add throws into `uploadScreenshot`.
- **`enrichPayload` failure must not block submission.** Handler catches, logs, and proceeds with the un-enriched payload. There's a test for this in `tests/handler.test.ts`.
- **Honeypot (`__hp`) returns 200 without invoking the adapter** so bots can't tell the field exists. Strip it before calling the adapter (also tested).
- **Rate limit state is in-memory per process** (`src/server/rate-limit.ts`). On serverless, each instance has its own `Map`, so the effective limit is per-instance — this is intentional. `_resetRateLimitForTests()` is the test escape hatch; don't use it from production code.
- **Payload merge is shallow on the top level but deep on `userContext` and `metadata`** so server enrichment can add fields without obliterating client-provided ones. See `mergePayload` in `handler.ts`.

### CSS pipeline (load-bearing)

The widget uses Tailwind utility classes directly in JSX. At build time, the **client tsup config's `onSuccess` hook** runs the Tailwind CLI against `src/client/styles.css` (which contains only `@tailwind utilities;`), scans `src/client/**/*.{ts,tsx}` for class names, and emits `dist/styles.css`. Consumers import that file once and don't have to add the package path to their own Tailwind `content`.

Two deliberate omissions in `tailwind.config.ts`:
- No `@tailwind base;` and `corePlugins.preflight: false` — we don't want to reset the host app's styles.
- No `prefix` — class names match standard Tailwind. If a consumer has redefined defaults (e.g. `bg-white`), import order matters.

If you add a new client component or use a class not previously seen, run `npm run build` so the new utility lands in `dist/styles.css`. A typecheck-only or `vitest` run won't refresh the CSS.

### SSR concerns

- `FeedbackWidget` lazy-imports `modern-screenshot` inside `captureScreenshot` so SSR doesn't try to evaluate a browser-only module at module load.
- `window` / `navigator` reads inside `handleSubmit` are guarded with `typeof window !== 'undefined'`.
- The widget's screenshot capture sets `data-capturing="true"` on the dialog and yields two `requestAnimationFrame` ticks before snapshotting `document.body` so the modal isn't in the screenshot.
