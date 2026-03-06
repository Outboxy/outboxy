import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { MaintenanceOperations } from "@outboxy/db-adapter-core";
import { INBOX_STATUS, TABLE } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";
import type { Logger } from "../config.js";
import { noopLogger } from "../config.js";

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

interface IdRow extends RowDataPacket {
  id: string;
}

/**
 * MySQL implementation of MaintenanceOperations
 *
 * Handles background maintenance tasks:
 * - Recovering stale events stuck in processing
 * - Cleaning up old idempotency keys
 */
export class MySQLMaintenance implements MaintenanceOperations {
  private readonly logger: Logger;

  constructor(
    private readonly pool: Pool,
    logger?: Logger,
  ) {
    this.logger = logger ?? noopLogger;
  }

  /**
   * Recover events stuck in "processing" state
   *
   * Resets events that have been processing for longer than threshold:
   * - Changes status from 'processing' to 'failed'
   * - Increments retry_count
   * - Sets next_retry_at to NOW() + 1 second
   *
   * Uses server-side NOW() to avoid clock skew issues.
   */
  async recoverStaleEvents(thresholdMs: number): Promise<number> {
    return withErrorMapping(async () => {
      // First, get IDs of stale events (MySQL doesn't support RETURNING)
      const thresholdSeconds = Math.ceil(thresholdMs / 1000);

      const [rows] = await this.pool.execute<IdRow[]>(
        `
        SELECT id FROM ${TABLE.OUTBOX_EVENTS}
        WHERE status = 'processing'
          AND processing_started_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
          AND retry_count < max_retries
        `,
        [thresholdSeconds],
      );

      if (rows.length === 0) {
        return 0;
      }

      const eventIds = rows.map((row) => row.id);
      validateIds(eventIds);
      const placeholders = eventIds.map(() => "?").join(",");

      const [result] = await this.pool.execute<ResultSetHeader>(
        `
        UPDATE ${TABLE.OUTBOX_EVENTS}
        SET
          status = 'failed',
          retry_count = retry_count + 1,
          last_error = 'Recovered from stale processing state',
          next_retry_at = DATE_ADD(NOW(), INTERVAL 1 SECOND),
          updated_at = NOW()
        WHERE id IN (${placeholders})
        `,
        eventIds,
      );

      const recoveredCount = result.affectedRows;

      if (recoveredCount > 0) {
        this.logger.warn(
          {
            recoveredCount,
            thresholdMs,
            eventIds,
          },
          "Recovered stale events",
        );
      }

      return recoveredCount;
    });
  }

  /**
   * Clean up stale idempotency keys from succeeded events
   *
   * Removes idempotency_key from events that:
   * - Have status = 'succeeded'
   * - Have idempotency_key IS NOT NULL
   * - Were processed more than retentionDays ago
   */
  async cleanupStaleIdempotencyKeys(retentionDays: number): Promise<number> {
    return withErrorMapping(async () => {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `
        UPDATE ${TABLE.OUTBOX_EVENTS}
        SET idempotency_key = NULL,
            updated_at = NOW()
        WHERE status = 'succeeded'
          AND idempotency_key IS NOT NULL
          AND processed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `,
        [retentionDays],
      );

      const clearedCount = result.affectedRows;

      if (clearedCount > 0) {
        this.logger.info(
          { clearedCount, retentionDays },
          "Cleared stale idempotency keys",
        );
      }

      return clearedCount;
    });
  }

  async cleanupProcessedInboxEvents(retentionDays: number): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("retentionDays must be a positive integer");
    }

    return withErrorMapping(async () => {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `
        DELETE FROM ${TABLE.INBOX_EVENTS}
        WHERE status = ?
          AND processed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `,
        [INBOX_STATUS.PROCESSED, retentionDays],
      );

      const deletedCount = result.affectedRows;

      if (deletedCount > 0) {
        this.logger.info(
          { deletedCount, retentionDays },
          "Cleaned up processed inbox events",
        );
      }

      return deletedCount;
    });
  }
}
