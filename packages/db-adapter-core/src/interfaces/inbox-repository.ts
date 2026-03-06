import type { InboxEventInput, InboxResult } from "@outboxy/schema";

/**
 * Repository interface for inbox database operations
 *
 * This interface defines the contract for all database operations used by the
 * inbox pattern. Implementations must handle:
 * - Atomic deduplication via ON CONFLICT DO NOTHING (PostgreSQL) or INSERT IGNORE (MySQL)
 * - Proper error handling and transaction management
 * - Cleanup of old processed events
 *
 * ## Executor Type
 *
 * The `executor` parameter is the database client/connection/transaction object.
 * This allows the repository to participate in the caller's transaction for atomicity.
 *
 * @example
 * ```typescript
 * // PostgreSQL with pg library
 * const client = await pool.connect();
 * await client.query('BEGIN');
 * const result = await inboxRepo.receive(event, client);
 * await client.query('COMMIT');
 *
 * // MySQL with mysql2
 * const conn = await pool.getConnection();
 * await conn.beginTransaction();
 * const result = await inboxRepo.receive(event, conn);
 * await conn.commit();
 * ```
 */
export interface InboxRepository<T = unknown> {
  /**
   * Receive and deduplicate an incoming event
   *
   * Inserts a record into inbox_events within the caller's transaction.
   * If the idempotency_key already exists, returns { status: 'duplicate' }.
   * If new, returns { status: 'processed', eventId }.
   *
   * MUST be called within an active database transaction for atomicity.
   *
   * @param event - The incoming event to receive (idempotencyKey is REQUIRED)
   * @param executor - Database client/connection/transaction object
   * @returns Result indicating whether the event was processed or is a duplicate
   */
  receive(event: InboxEventInput, executor: T): Promise<InboxResult>;

  /**
   * Bulk receive for batch processing (Kafka consumers, batch webhooks)
   *
   * Inserts multiple records into inbox_events within the caller's transaction.
   * Handles partial duplicates - some events may be new, some may be duplicates.
   *
   * MUST be called within an active database transaction for atomicity.
   *
   * @param events - Array of incoming events to receive
   * @param executor - Database client/connection/transaction object
   * @returns Array of results, one per input event, in the same order
   */
  receiveBatch(events: InboxEventInput[], executor: T): Promise<InboxResult[]>;

  /**
   * Mark an event as failed (for business-logic failures)
   *
   * Use for business-logic failures that should be recorded but not retried.
   * The event remains in the inbox (dedup still active) but is flagged for
   * operational attention.
   *
   * This is an ALTERNATIVE to rolling back the transaction. If you roll back,
   * the event can be re-received. If you mark failed, the event is permanently
   * deduplicated but flagged as failed.
   *
   * @param eventId - The ID of the event to mark as failed
   * @param error - Error message describing the failure
   * @param executor - Database client/connection/transaction object
   */
  markFailed(eventId: string, error: string, executor: T): Promise<void>;

  /**
   * Remove processed events older than retention days
   *
   * MUST be called periodically to prevent unbounded table/index growth.
   * Recommended: daily cron job or worker maintenance loop.
   *
   * After cleanup, events older than retentionDays can theoretically be
   * reprocessed if re-delivered — acceptable under at-least-once semantics.
   *
   * @param retentionDays - Number of days to keep processed events
   * @param executor - Database client/connection/transaction object
   * @returns Number of events deleted
   */
  cleanupProcessedEvents(retentionDays: number, executor: T): Promise<number>;
}
