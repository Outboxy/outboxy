/**
 * Interface for background maintenance operations
 *
 * These operations run periodically to maintain database health
 * and recover from edge cases (e.g., worker crashes).
 */
export interface MaintenanceOperations {
  /**
   * Recover events stuck in "processing" state
   *
   * If a worker crashes while processing events, those events remain
   * in "processing" state indefinitely. This operation recovers them
   * by resetting to "failed" status with incremented retry count.
   *
   * @param thresholdMs - How long an event must be stuck before recovery (default: 5 minutes)
   * @returns Number of events recovered
   */
  recoverStaleEvents(thresholdMs: number): Promise<number>;

  /**
   * Clean up old idempotency keys from succeeded events
   *
   * Idempotency keys are cleared from succeeded events after retention
   * period to prevent the unique index from growing indefinitely.
   *
   * @param retentionDays - How long to keep idempotency keys (default: 30 days)
   * @returns Number of idempotency keys cleared
   */
  cleanupStaleIdempotencyKeys(retentionDays: number): Promise<number>;

  /**
   * Remove processed inbox events older than the retention period
   *
   * Optional — only implemented by adapters that support the inbox pattern.
   *
   * @param retentionDays - Number of days to retain processed events
   * @returns Number of events deleted
   */
  cleanupProcessedInboxEvents?(retentionDays: number): Promise<number>;
}
