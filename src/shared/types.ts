export type FeedbackType = 'bug' | 'feedback' | 'feature'

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
