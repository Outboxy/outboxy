import type { Pool } from "pg";
import type { MaintenanceOperations } from "@outboxy/db-adapter-core";
import { INBOX_STATUS, TABLE } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";
import type { Logger } from "../config.js";
import { noopLogger } from "../config.js";

/**
 * PostgreSQL implementation of MaintenanceOperations
 *
 * Handles background maintenance tasks:
 * - Recovering stale events stuck in processing
 * - Cleaning up old idempotency keys
 */
export class PgMaintenance implements MaintenanceOperations {
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
      const result = await this.pool.query(
        `
        UPDATE ${TABLE.OUTBOX_EVENTS}
        SET
          status = 'failed',
          retry_count = retry_count + 1,
          last_error = 'Recovered from stale processing state',
          next_retry_at = NOW() + interval '1 second',
          updated_at = NOW()
        WHERE status = 'processing'
          AND processing_started_at < NOW() - ($1 * interval '1 millisecond')
          AND retry_count < max_retries
        RETURNING id
        `,
        [thresholdMs],
      );

      const recoveredCount = result.rowCount ?? 0;
      const recoveredIds = result.rows.map((row) => row.id);

      if (recoveredCount > 0) {
        this.logger.warn(
          {
            recoveredCount,
            thresholdMs,
            eventIds: recoveredIds,
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
   * SECURITY FIX: Uses parameterized query instead of string interpolation
   * to prevent SQL injection.
   *
   * Removes idempotency_key from events that:
   * - Have status = 'succeeded'
   * - Have idempotency_key IS NOT NULL
   * - Were processed more than retentionDays ago
   */
  async cleanupStaleIdempotencyKeys(retentionDays: number): Promise<number> {
    return withErrorMapping(async () => {
      // SECURITY: Use parameterized query with interval calculation
      const result = await this.pool.query(
        `
        UPDATE ${TABLE.OUTBOX_EVENTS}
        SET idempotency_key = NULL,
            updated_at = NOW()
        WHERE status = 'succeeded'
          AND idempotency_key IS NOT NULL
          AND processed_at < NOW() - ($1 * interval '1 day')
        `,
        [retentionDays],
      );

      const clearedCount = result.rowCount ?? 0;

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
      const result = await this.pool.query(
        `
        DELETE FROM ${TABLE.INBOX_EVENTS}
        WHERE status = $1
          AND processed_at < NOW() - ($2 * interval '1 day')
        `,
        [INBOX_STATUS.PROCESSED, retentionDays],
      );

      const deletedCount = result.rowCount ?? 0;

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
