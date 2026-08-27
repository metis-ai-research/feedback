/**
 * THE feedback vocabulary. One set of keys for every caller and every backend.
 *
 * These six are the agreed canonical categories, shared with Metis OS's
 * intake registry (`lib/feedback-sources.ts` there). They exist because the
 * same six ideas had grown four different spellings across four projects —
 * `technical-issues` in one, `bug` in another, `general-inquiries` and
 * `general` for one meaning — which made every new caller a bespoke
 * integration and every mismatch a 400 that only surfaced on the first real
 * submission.
 *
 * A form offers a SUBSET of these. It never invents a key. What the person
 * reads is your form's business — localize it freely — but `bug` goes out as
 * `bug`.
 */
export const FEEDBACK_CATEGORIES = [
  'bug',
  'feature',
  'feedback',
  'question',
  'payment',
  'other',
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
}

/**
 * @deprecated Prefer `FeedbackCategory`. Kept as an alias so existing
 * `FeedbackType` imports keep compiling; it widened from three values to six
 * in 0.2.0, which is additive for anything that SENDS a value.
 */
export type FeedbackType = FeedbackCategory

export interface UserContext {
  /** The URL the user was on when they submitted feedback. */
  url?: string
  /** Browser user agent (auto-captured client-side). */
  userAgent?: string
  /** Authenticated user id, if available. */
  userId?: string
  /** Authenticated user email, if available. */
  userEmail?: string
  /** Authenticated user display name, if available. */
  userName?: string
  /** Application version at submit time (e.g. git SHA, semver). */
  appVersion?: string
  /** Browser viewport at submit time. */
  viewport?: { width: number; height: number }
}

export interface FeedbackPayload {
  type: FeedbackType
  title: string
  description: string
  /** PNG data URL captured client-side. Adapter decides how to attach it. */
  screenshotDataUrl?: string
  userContext?: UserContext
  /** Free-form context the consuming app sets per submission. */
  metadata?: Record<string, unknown>
}

export interface FeedbackResult {
  ok: boolean
  /** When ok=true, the URL of the created ticket (if the adapter returns one). */
  ticketUrl?: string
  /** When ok=false, a short error message. Safe to surface to the user. */
  error?: string
}
