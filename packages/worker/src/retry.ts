import type { PublishResult } from "@outboxy/publisher-core";

/**
 * Result of retry decision logic
 */
export type RetryDecision = "succeeded" | "retry" | "dlq";

/**
 * Decide what to do with an event after a publish attempt
 *
 * Decision logic:
 * - Success → succeeded (mark as completed)
 * - Non-retryable failure → dlq (never retry)
 * - Retryable failure with retries remaining → retry (schedule with backoff)
 * - Retryable failure with max retries exceeded → dlq (give up)
 *
 * @param result - Result from publisher.publish()
 * @param retryCount - Current retry count for the event
 * @param maxRetries - Maximum allowed retries (from config or event)
 * @returns Decision: succeeded, retry, or dlq
 */
export function decideRetry(
  result: PublishResult,
  retryCount: number,
  maxRetries: number,
): RetryDecision {
  if (result.success) {
    return "succeeded";
  }

  // Failed event - check if we should retry or send to DLQ
  if (!result.retryable || retryCount >= maxRetries) {
    return "dlq";
  }

  return "retry";
}
