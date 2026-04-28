/**
 * `createFeedbackHandler({ adapter, rateLimit, enrichPayload })`
 *
 * Returns a Web-API-compatible POST handler suitable for Next.js App Router
 * route files (`export const POST = createFeedbackHandler(...)`), as well
 * as any other framework that accepts `(req: Request) => Promise<Response>`.
 */

import { z } from 'zod'
import type { FeedbackAdapter } from '../adapters/types'
import type { FeedbackPayload } from '../shared/types'
import { checkRateLimit } from './rate-limit'

const PayloadSchema = z.object({
  type: z.enum(['bug', 'feedback', 'feature']),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(10_000),
  screenshotDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/, 'Invalid screenshot format')
    .max(10_000_000, 'Screenshot is too large')
    .optional(),
  userContext: z
    .object({
      url: z.string().url().optional(),
      userAgent: z.string().max(500).optional(),
      userId: z.string().max(200).optional(),
      userEmail: z.string().email().optional(),
      userName: z.string().max(200).optional(),
      appVersion: z.string().max(100).optional(),
      viewport: z
        .object({
          width: z.number().int().nonnegative(),
          height: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  // Honeypot. Real users don't see or fill it; bots that auto-fill every
  // field will trip it. We accept the request but silently drop it.
  __hp: z.string().optional(),
})

export interface CreateFeedbackHandlerOptions {
  adapter: FeedbackAdapter
  /**
   * Default: 10 requests / 60s per IP. Set to `false` to disable.
   */
  rateLimit?: { maxPerWindow: number; windowMs: number } | false
  /**
   * Server-side hook to add fields the client shouldn't be trusted to set
   * (e.g. authoritative userId from session). Returned partial is merged
   * onto the validated payload.
   */
  enrichPayload?: (
    payload: FeedbackPayload,
    request: Request
  ) => Promise<Partial<FeedbackPayload>> | Partial<FeedbackPayload>
}

const DEFAULT_RATE_LIMIT = { maxPerWindow: 10, windowMs: 60_000 } as const

export function createFeedbackHandler(opts: CreateFeedbackHandlerOptions) {
  const rl = opts.rateLimit === false ? null : opts.rateLimit ?? DEFAULT_RATE_LIMIT

  return async function POST(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400)
    }

    const parsed = PayloadSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      return jsonResponse(
        { ok: false, error: firstIssue?.message ?? 'Invalid payload' },
        400
      )
    }

    // Honeypot — real users never fill it. Pretend success so bots don't
    // learn that the field exists.
    if (parsed.data.__hp && parsed.data.__hp.length > 0) {
      return jsonResponse({ ok: true }, 200)
    }

    if (rl) {
      const ip = getClientIp(request)
      if (!checkRateLimit(ip, rl.maxPerWindow, rl.windowMs)) {
        return jsonResponse(
          { ok: false, error: 'Too many requests. Please try again in a minute.' },
          429
        )
      }
    }

    // Strip the honeypot before passing to the adapter.
    const { __hp: _hp, ...validated } = parsed.data
    let payload: FeedbackPayload = validated as FeedbackPayload

    if (opts.enrichPayload) {
      try {
        const extra = await opts.enrichPayload(payload, request)
        payload = mergePayload(payload, extra)
      } catch (err) {
        // Enrichment failures must not block submission. Log + continue
        // with un-enriched payload.
        console.error('[@metis/feedback] enrichPayload threw:', err)
      }
    }

    let result
    try {
      result = await opts.adapter.submit(payload)
    } catch (err) {
      console.error(
        `[@metis/feedback] adapter ${opts.adapter.name} threw:`,
        err
      )
      return jsonResponse({ ok: false, error: 'Adapter error' }, 502)
    }

    if (!result.ok) {
      return jsonResponse(
        { ok: false, error: result.error ?? 'Submission failed' },
        502
      )
    }
    return jsonResponse({ ok: true, ticketUrl: result.ticketUrl }, 200)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]
    if (first) return first.trim()
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function mergePayload(
  base: FeedbackPayload,
  extra: Partial<FeedbackPayload>
): FeedbackPayload {
  return {
    ...base,
    ...extra,
    // Deep-merge userContext + metadata so enrichment can add fields
    // without obliterating client-provided ones.
    userContext: extra.userContext
      ? { ...base.userContext, ...extra.userContext }
      : base.userContext,
    metadata: extra.metadata
      ? { ...base.metadata, ...extra.metadata }
      : base.metadata,
  }
}
