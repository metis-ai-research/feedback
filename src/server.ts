// Server entry — for use in API route handlers (Node.js / Edge runtimes).
export { createFeedbackHandler } from './server/handler'
export type { CreateFeedbackHandlerOptions } from './server/handler'
export type { FeedbackAdapter } from './adapters/types'
export type {
  FeedbackPayload,
  FeedbackResult,
  FeedbackType,
  UserContext,
} from './shared/types'
