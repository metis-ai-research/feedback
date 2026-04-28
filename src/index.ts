// Client entry — included with the `'use client'` banner so Next.js / RSC
// consumers can drop it into a server-rendered tree without thinking.
export { FeedbackWidget } from './client/FeedbackWidget'
export type {
  FeedbackWidgetProps,
  FeedbackUser,
} from './client/FeedbackWidget'
export type {
  FeedbackPayload,
  FeedbackResult,
  FeedbackType,
  UserContext,
} from './shared/types'
