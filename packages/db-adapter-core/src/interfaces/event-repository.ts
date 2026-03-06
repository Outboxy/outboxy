import type { OutboxEvent } from "@outboxy/schema";
import type { BackoffConfig } from "../types.js";

/**
 * Repository interface for worker database operations
 *
 * This interface defines the contract for all database operations used by the
 * outbox worker. Implementations must handle:
 * - Concurrent worker safety (e.g., FOR UPDATE SKIP LOCKED in PostgreSQL)
 * - Batch operations for efficiency
 * - Proper error handling and transaction management
 */
export interface EventRepository {
  /**
   * Claim pending events for processing
   *
   * CRITICAL: Implementation must use database-specific row-level locking
   * (e.g., FOR UPDATE SKIP LOCKED in PostgreSQL) to prevent race conditions
   * between concurrent workers.
   *
   * @param batchSize - Maximum number of events to claim
   * @returns Array of claimed events (may be empty if none available)
   */
  claimPendingEvents(batchSize: number): Promise<OutboxEvent[]>;

  /**
   * Get count of events ready for processing
   *
   * Used for adaptive polling - worker adjusts poll interval based on queue depth.
   * Should return events that are either pending or failed (and ready to retry).
   *
   * @returns Number of events ready for processing
   */
  getPendingEventCount(): Promise<number>;

  /**
   * Mark multiple events as successfully processed
   *
   * Batch operation - should execute as a single query for efficiency.
   *
   * @param results - Array of event IDs with their processing worker IDs
   */
  markSucceeded(
    results: Array<{ eventId: string; workerId: string }>,
  ): Promise<void>;

  /**
   * Schedule retries for failed events with exponential backoff
   *
   * Only schedules retry if event hasn't exceeded max_retries.
   * Backoff calculation: baseMs * (multiplier ^ retryCount)
   *
   * @param eventIds - IDs of events to retry
   * @param errorMessages - Map of event ID to error message
   * @param config - Backoff configuration (base delay, multiplier)
   */
  scheduleRetry(
    eventIds: string[],
    errorMessages: Map<string, string>,
    config: BackoffConfig,
  ): Promise<void>;

  /**
   * Move events to dead letter queue
   *
   * Events are moved to DLQ when they've exceeded max retries or
   * encountered non-retryable errors.
   *
   * @param eventIds - IDs of events to move to DLQ
   * @param errorMessages - Map of event ID to final error message
   */
  moveToDLQ(
    eventIds: string[],
    errorMessages: Map<string, string>,
  ): Promise<void>;
}
