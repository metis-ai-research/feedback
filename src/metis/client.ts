/**
 * The Metis OS transport.
 *
 * One place that knows the wire format of `POST os.metis-ai.io/api/feedback`,
 * so callers stop hand-rolling it. Before this existed the same twenty lines of
 * `fetch` were copy-pasted into arotaro.ai, the AroTaro app, blinc's landing
 * page and the Blinc app — four copies that had already drifted on category
 * names, on whether the server's error string was shown to the user, and on
 * whether a failed send cleared what the person had typed.
 *
 * **No React, no DOM, no Tailwind.** This entry is deliberately importable from
 * React Native and from a plain `<script>`; the widget in `../client` builds on
 * the same types but is a separate entry point. The only runtime requirement is
 * `fetch` and `AbortController`.
 *
 * This is the INBOUND direction: the project calls Metis OS, which holds the
 * Linear credential and decides where the ticket goes. Nothing here talks to
 * Linear, and nothing here should ever be given a way to name a team, a label
 * or an assignee — that routing lives in Metis OS's registry precisely so a
 * compromised key cannot redirect it.
 */

import { isFeedbackCategory, type FeedbackCategory } from '../shared/types'

export const METIS_ENDPOINT = 'https://os.metis-ai.io/api/feedback'

/** `{ok:true,data}` / `{ok:false,error}` — the kit's envelope, read in the
    direction where Metis OS returns it and the project renders it. `error` is
    deliberately not read: see DEFAULT_MESSAGES. */
interface ResponseEnvelope {
  ok?: boolean
  data?: { ticketUrl?: string }
}

/** `{app, platform, locale}`, and nothing else. */
export interface FeedbackDiagnostics {
  /** The build actually running, e.g. `1.4.0 (18302)`. Read it from the
      installed binary, never from bundled config — an OTA update changes the
      JS and not the native version, and a report naming the wrong build sends
      triage the wrong way. */
  app?: string
  /** e.g. `Android 15 · Samsung SM-S911B`. */
  platform?: string
  /** e.g. `ko-KR`. */
  locale?: string
}

export interface FeedbackAttachment {
  filename: string
  contentType: string
  /** Data URL. Cap at 3MB raw client-side; the endpoint rejects bodies over
      4MB with a 413. */
  dataUrl: string
}

export interface MetisFeedbackClientOptions {
  /** The source slug from the project's Feedback page in Metis OS. */
  source: string
  /**
   * The public key from that same page.
   *
   * PUBLIC, and committed on purpose: it ships in a browser bundle or an app
   * binary either way, so treating it as a secret only buys useless work. It
   * identifies the caller rather than authenticating it, and gives you a revoke
   * button. What actually bounds abuse is the origin allowlist, the per-source
   * rate limit, and being able to retire the source — all in Metis OS.
   */
  key: string
  /**
   * `'app'` for a native client: it drops the `name` requirement and makes
   * `email` optional. It only ever widens what is ACCEPTED, never what is
   * trusted — sending it from a web page buys nothing but a worse ticket title.
   */
  kind?: 'site' | 'app'
  /** Override for tests or a staging deployment. */
  endpoint?: string
  /** A phone on a flaky connection should fail fast enough to offer a retry. */
  timeoutMs?: number
  /**
   * Your copy, by failure kind. Metis OS's own `error` strings are English
   * telemetry markers rather than UI, so this client never surfaces them — see
   * `DEFAULT_MESSAGES`. Localized apps pass their own.
   */
  messages?: Partial<Record<SendFailureKind, string>>
}

export interface SendFeedbackInput {
  /** One of the six, and one this source offers. */
  category: FeedbackCategory
  content: string
  /** Required unless `kind` is `'app'`. */
  name?: string
  /** Required unless `kind` is `'app'`. */
  email?: string
  diagnostics?: FeedbackDiagnostics
  attachment?: FeedbackAttachment
}

/**
 * Why it failed, so the form can give advice that matches reality. Telling
 * someone to check their connection after the server rejected their input
 * sends them to look at their wifi over a problem that is not there.
 */
export type SendFailureKind =
  /** Never reached the server: offline, DNS, or the timeout. */
  | 'offline'
  /** Reached it and was rejected. Retrying the same input will not help. */
  | 'invalid'
  /** Reached it and it could not complete. The same input succeeds later. */
  | 'server'

export type SendFeedbackResult =
  | { ok: true; ticketUrl?: string }
  | { ok: false; kind: SendFailureKind; status?: number; error: string }

export const DEFAULT_MESSAGES: Record<SendFailureKind, string> = {
  offline: 'Couldn’t reach the server. Check your connection and try again.',
  invalid: 'That didn’t go through. Please check what you wrote and try again.',
  server: 'Something went wrong sending that. Your message is still here — please try again.',
}

/**
 * A 429 is a 4xx that behaves like a server condition — the same input
 * succeeds later — so it belongs with `server` rather than with the
 * reject-and-do-not-retry cases.
 *
 * A 404 means the source is unknown, the key is wrong, or the source is
 * switched off. All three answer identically by design, and none of them are
 * something the person typing can fix, so it reads as `server` too: it is a
 * configuration fault, not a user error.
 */
export function failureKindFor(status: number): SendFailureKind {
  if (status === 429 || status === 404) return 'server'
  return status >= 400 && status < 500 ? 'invalid' : 'server'
}

/**
 * Build a client bound to one source. Never throws: a failed send resolves to
 * `{ ok: false }` so the form can keep what the person typed on screen and
 * offer a retry. Losing four paragraphs to a 502 is worse than the outage.
 */
export function createMetisFeedbackClient(options: MetisFeedbackClientOptions) {
  const {
    source,
    key,
    kind = 'site',
    endpoint = METIS_ENDPOINT,
    timeoutMs = 15000,
    messages,
  } = options

  if (!source) throw new Error('createMetisFeedbackClient: source is required')
  if (!key) throw new Error('createMetisFeedbackClient: key is required')

  const copy = { ...DEFAULT_MESSAGES, ...messages }

  return {
    source,
    kind,
    endpoint,

    async send(input: SendFeedbackInput): Promise<SendFeedbackResult> {
      // Caught here rather than at the endpoint, because a 400 for a category
      // the caller could have checked is a round trip wasted on a phone.
      if (!isFeedbackCategory(input.category)) {
        return { ok: false, kind: 'invalid', error: copy.invalid }
      }

      const content = input.content?.trim()
      if (!content) return { ok: false, kind: 'invalid', error: copy.invalid }

      const email = input.email?.trim()
      const name = input.name?.trim()

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            key,
            kind,
            category: input.category,
            content,
            // Omitted rather than sent empty: the endpoint requires `name` on a
            // site submission, and `""` would fail the check less clearly.
            name: name || undefined,
            email: email || undefined,
            diagnostics: input.diagnostics,
            attachment: input.attachment,
          }),
          signal: controller.signal,
        })

        // The endpoint answers JSON on every path it controls, but a proxy or a
        // cold start can still return HTML — so parsing is allowed to fail
        // without taking the branch with it.
        let body: ResponseEnvelope | null = null
        try {
          body = (await res.json()) as ResponseEnvelope
        } catch {
          body = null
        }

        // A 200 whose envelope says otherwise is still a failure.
        if (res.ok && body?.ok) return { ok: true, ticketUrl: body.data?.ticketUrl }

        const failure = failureKindFor(res.status)
        return { ok: false, kind: failure, status: res.status, error: copy[failure] }
      } catch {
        return { ok: false, kind: 'offline', error: copy.offline }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export type MetisFeedbackClient = ReturnType<typeof createMetisFeedbackClient>
