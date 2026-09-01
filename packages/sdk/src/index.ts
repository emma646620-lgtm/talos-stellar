export { TalosClient } from "./client.js";
export type { TalosClientOptions, RetryOptions, TalosErrorEvent } from "./client.js";
export { TalosAPIError } from "./errors.js";
export type { TalosAPIErrorOptions, TalosErrorCode } from "./errors.js";
export {
  TalosValidationError,
  TalosAuthenticationError,
  TalosForbiddenError,
  TalosNotFoundError,
  TalosConflictError,
  TalosPaymentError,
  TalosRateLimitError,
  TalosServerError,
  TalosServerRetryableError,
  TalosTransportError,
  TalosTimeoutError,
  errorFromResponse,
  classifyTransportError,
  sanitizeBody,
  redactSecrets,
  snapshotHeaders,
  parseRetryAfter,
  parseX402Challenge,
  MAX_BODY_BYTES,
} from "./errors.js";
export * from "./types.js";
export * from "./stellar.js";
export * from "./webhooks.js";
export * from "./a2a-intent.js";
export * from "./a2a-validation.js";
export * from "./a2a-operations.js";
export {
  TalosEventStream,
  TalosStreamError,
  InMemorySeenStore,
} from "./events.js";
export type {
  TalosEventType,
  TalosStreamEvent,
  TalosEventHandler,
  TalosStreamErrorHandler,
  TalosStreamCloseHandler,
  TalosEventStreamOptions,
  SeenStore,
} from "./events.js";

// Typed pagination helpers
export interface TalosPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface TalosPageParams {
  limit?: number;
  cursor?: string;
}

export * from "./pagination.js";