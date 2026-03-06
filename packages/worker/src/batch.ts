import type { PublishResult } from "@outboxy/publisher-core";
import { decideRetry } from "./retry.js";

/**
 * Result of batch grouping operation
 */
export interface BatchGroupingResult {
  succeeded: string[];
  retried: string[];
  dlq: string[];
}

/**
 * Group event results by outcome for batch database operations
 *
 * This function processes the results from publisher.publish() and groups
 * events by their final outcome (succeeded, retry, dlq) for efficient batch
 * database updates.
 *
 * Grouping logic:
 * - succeeded: Events that were successfully published
 * - retried: Retryable failures with retries remaining
 * - dlq: Non-retryable failures OR retryable failures exceeding max retries
 *
 * @param results - Map of event ID to publish result from publisher
 * @param retryCount - Map of event ID to current retry count
 * @param maxRetries - Maximum allowed retries (from config)
 * @returns Grouping result with three arrays of event IDs
 */
export function groupBatchResults(
  results: Map<string, PublishResult>,
  retryCount: Map<string, number>,
  maxRetries: number,
): BatchGroupingResult {
  const succeeded: string[] = [];
  const retried: string[] = [];
  const dlq: string[] = [];

  for (const [eventId, result] of results) {
    const currentRetryCount = retryCount.get(eventId) ?? 0;
    const decision = decideRetry(result, currentRetryCount, maxRetries);

    switch (decision) {
      case "succeeded":
        succeeded.push(eventId);
        break;
      case "retry":
        retried.push(eventId);
        break;
      case "dlq":
        dlq.push(eventId);
        break;
    }
  }

  return { succeeded, retried, dlq };
}
