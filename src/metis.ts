// Metis OS entry — framework-free on purpose.
//
// No React, no DOM, no Tailwind, so this is importable from React Native and
// from a plain script tag as well as from a web app. Keep it that way: anything
// added here that touches `window` or `react` breaks the two mobile apps that
// depend on this entry point.
export {
  createMetisFeedbackClient,
  failureKindFor,
  DEFAULT_MESSAGES,
  METIS_ENDPOINT,
} from './metis/client'
export type {
  FeedbackAttachment,
  FeedbackDiagnostics,
  MetisFeedbackClient,
  MetisFeedbackClientOptions,
  SendFailureKind,
  SendFeedbackInput,
  SendFeedbackResult,
} from './metis/client'
export { FEEDBACK_CATEGORIES, isFeedbackCategory } from './shared/types'
export type { FeedbackCategory } from './shared/types'
