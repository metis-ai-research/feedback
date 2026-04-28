import type { FeedbackPayload, FeedbackResult } from '../shared/types'

/**
 * An adapter takes a validated FeedbackPayload and forwards it to a
 * destination (Linear, GitHub Issues, Plain, Slack — anything).
 *
 * Contract:
 *   - `submit` MUST NOT throw on transport errors. Wrap in try/catch and
 *     return `{ ok: false, error: ... }` instead. The handler treats
 *     thrown errors as 500s; well-behaved adapters return 502-style
 *     errors via `ok: false` so the handler can map them cleanly.
 *   - `submit` SHOULD return `ticketUrl` when the destination provides one,
 *     so the widget can show a "View on Linear" link in success state.
 */
export interface FeedbackAdapter {
  /** Short identifier for logging (e.g. 'linear', 'github'). */
  name: string
  submit(payload: FeedbackPayload): Promise<FeedbackResult>
}
