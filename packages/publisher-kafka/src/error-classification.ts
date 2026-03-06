/**
 * Kafka error classification utilities
 *
 * Determines whether Kafka errors are retryable (transient) or permanent.
 */

/**
 * Error patterns that indicate permanent failures (should not be retried)
 *
 * These errors indicate configuration issues, permission problems, or invalid
 * requests that will not succeed on retry.
 */
export const NON_RETRYABLE_PATTERNS = [
  "unknown topic",
  "invalid topic",
  "authorization failed",
  "authentication failed",
  "invalid message",
  "topic marked for deletion",
  "unsupported version",
] as const;

/**
 * Determine if a Kafka error is retryable
 *
 * **Retryable errors** (worker will retry with backoff):
 * - Network errors (ECONNREFUSED, ETIMEDOUT)
 * - Broker unavailable, leader not available
 * - Request timeouts
 * - Retriable Kafka errors (documented in kafkajs)
 *
 * **Non-retryable errors** (move to DLQ):
 * - Unknown topic, invalid topic
 * - Authorization/authentication failures
 * - Invalid message format
 * - Topic marked for deletion
 *
 * @param error - The error to classify
 * @returns true if the error is retryable, false otherwise
 */
export function isRetryableKafkaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const errorMessage = error.message.toLowerCase();

  if (
    NON_RETRYABLE_PATTERNS.some((pattern) => errorMessage.includes(pattern))
  ) {
    return false;
  }

  return true;
}
