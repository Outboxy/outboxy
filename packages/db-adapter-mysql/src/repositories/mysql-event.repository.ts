import type { Pool, RowDataPacket } from "mysql2/promise";
import type {
  EventRepository,
  BackoffConfig,
  OutboxEvent,
  OutboxEventRow,
} from "@outboxy/db-adapter-core";
import { mapRowToEvent, MAX_ERROR_MESSAGE_LENGTH } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

/**
 * UUID validation regex for validating event IDs
 * Prevents SQL injection when building IN clauses
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that all IDs are properly formatted UUIDs
 *
 * Critical for security when building dynamic IN clauses.
 * Throws if any ID is not a valid UUID format.
 */
function validateIds(ids: string[]): void {
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      throw new Error(`Invalid event ID format: ${id}`);
    }
  }
}

/**
 * MySQL-specific row type that extends OutboxEventRow with RowDataPacket
 * for mysql2 query result compatibility.
 */
interface MySQLOutboxEventRow extends OutboxEventRow, RowDataPacket {}

interface CountRow extends RowDataPacket {
  count: number;
}

/**
 * MySQL implementation of EventRepository using raw SQL
 *
 * Uses MySQL-specific features:
 * - FOR UPDATE SKIP LOCKED for concurrent worker safety
 * - ON DUPLICATE KEY UPDATE for idempotency
 * - JSON type for payload storage
 */
export class MySQLEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Claim pending events for processing
   *
   * Uses FOR UPDATE SKIP LOCKED to prevent race conditions
   * between concurrent workers.
   *
   * CRITICAL MySQL-specific behavior:
   * - Uses READ COMMITTED to avoid InnoDB gap locks
   * - Does NOT use ORDER BY with SKIP LOCKED because MySQL's ORDER BY + FOR UPDATE
   *   scans and locks ALL rows in the range, making SKIP LOCKED ineffective
   * - Instead, lets SKIP LOCKED return any available rows (order doesn't matter
   *   for the outbox pattern - all pending events need processing)
   */
  async claimPendingEvents(batchSize: number): Promise<OutboxEvent[]> {
    return withErrorMapping(async () => {
      const connection = await this.pool.getConnection();
      try {
        // Use READ COMMITTED to avoid gap locking issues with SKIP LOCKED
        await connection.query(
          "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
        );
        await connection.beginTransaction();

        // Get IDs of events to claim using FOR UPDATE SKIP LOCKED
        // IMPORTANT: No ORDER BY - MySQL's ORDER BY + FOR UPDATE locks entire
        // scan range, breaking SKIP LOCKED. Order doesn't matter for outbox.
        const [idRows] = await connection.query<
          ({ id: string } & RowDataPacket)[]
        >(
          `
          SELECT id
          FROM outbox_events
          WHERE (status = 'pending' OR (status = 'failed' AND next_retry_at <= NOW()))
            AND deleted_at IS NULL
          LIMIT ?
          FOR UPDATE SKIP LOCKED
          `,
          [batchSize],
        );

        if (idRows.length === 0) {
          await connection.rollback();
          return [];
        }

        // Extract IDs and validate
        const ids = idRows.map((row) => row.id);
        validateIds(ids);
        const placeholders = ids.map(() => "?").join(",");

        // Update status to processing
        await connection.execute(
          `
          UPDATE outbox_events
          SET status = 'processing',
              processing_started_at = NOW(),
              updated_at = NOW()
          WHERE id IN (${placeholders})
          `,
          ids,
        );

        await connection.commit();

        // Query to get updated rows with new status
        const [updatedRows] = await connection.query<MySQLOutboxEventRow[]>(
          `
          SELECT * FROM outbox_events WHERE id IN (${placeholders})
          `,
          ids,
        );

        return updatedRows.map((row: MySQLOutboxEventRow) =>
          mapRowToEvent(row),
        );
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
  }

  /**
   * Get count of events ready for processing
   */
  async getPendingEventCount(): Promise<number> {
    return withErrorMapping(async () => {
      const [rows] = await this.pool.execute<CountRow[]>(
        `
        SELECT COUNT(*) as count
        FROM outbox_events
        WHERE (status = 'pending' OR (status = 'failed' AND next_retry_at <= NOW()))
          AND deleted_at IS NULL
        `,
      );
      return Number(rows[0]?.count ?? 0);
    });
  }

  /**
   * Mark multiple events as successfully processed
   */
  async markSucceeded(
    results: Array<{ eventId: string; workerId: string }>,
  ): Promise<void> {
    if (results.length === 0) return;

    return withErrorMapping(async () => {
      // Build batch update using CASE statements
      const ids = results.map((r) => r.eventId);
      validateIds(ids);
      const workerCases = results.map(() => `WHEN ? THEN ?`).join(" ");
      const workerParams = results.flatMap((r) => [r.eventId, r.workerId]);

      const placeholders = ids.map(() => "?").join(",");

      await this.pool.execute(
        `
        UPDATE outbox_events
        SET status = 'succeeded',
            processed_at = NOW(),
            processed_by_worker = CASE id ${workerCases} END,
            updated_at = NOW()
        WHERE id IN (${placeholders})
        `,
        [...workerParams, ...ids],
      );
    });
  }

  /**
   * Schedule retries for failed events with exponential backoff
   *
   * Only schedules retry if event hasn't exceeded max_retries.
   * Events that have exceeded max_retries are NOT modified -
   * caller must explicitly call moveToDLQ() for these events.
   */
  async scheduleRetry(
    eventIds: string[],
    errorMessages: Map<string, string>,
    config: BackoffConfig,
  ): Promise<void> {
    if (eventIds.length === 0) return;

    validateIds(eventIds);

    return withErrorMapping(async () => {
      // Build CASE statement for last_error
      const errorCases = eventIds.map(() => `WHEN ? THEN ?`).join(" ");
      const errorParams = eventIds.flatMap((id) => [
        id,
        (errorMessages.get(id) || "Unknown error").substring(
          0,
          MAX_ERROR_MESSAGE_LENGTH,
        ),
      ]);

      const placeholders = eventIds.map(() => "?").join(",");

      // Only update events that haven't exceeded max_retries
      // Events at max_retries are silently skipped - caller must use moveToDLQ()
      await this.pool.execute(
        `
        UPDATE outbox_events
        SET status = 'failed',
            retry_count = retry_count + 1,
            next_retry_at = DATE_ADD(NOW(), INTERVAL CEIL((? * POW(?, retry_count)) / 1000) SECOND),
            last_error = CASE id ${errorCases} END,
            processing_started_at = NULL,
            updated_at = NOW()
        WHERE id IN (${placeholders})
          AND retry_count < max_retries
        `,
        [
          config.backoffBaseMs,
          config.backoffMultiplier,
          ...errorParams,
          ...eventIds,
        ],
      );
    });
  }

  /**
   * Move events to dead letter queue
   */
  async moveToDLQ(
    eventIds: string[],
    errorMessages: Map<string, string>,
  ): Promise<void> {
    if (eventIds.length === 0) return;

    validateIds(eventIds);

    return withErrorMapping(async () => {
      // Build batch update using CASE statements
      const errorCases = eventIds.map(() => `WHEN ? THEN ?`).join(" ");
      const errorParams = eventIds.flatMap((id) => [
        id,
        (errorMessages.get(id) || "Moved to DLQ").substring(
          0,
          MAX_ERROR_MESSAGE_LENGTH,
        ),
      ]);

      const placeholders = eventIds.map(() => "?").join(",");

      await this.pool.execute(
        `
        UPDATE outbox_events
        SET status = 'dlq',
            last_error = CASE id ${errorCases} END,
            updated_at = NOW()
        WHERE id IN (${placeholders})
        `,
        [...errorParams, ...eventIds],
      );
    });
  }
}
