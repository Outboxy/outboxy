import type { Pool, PoolClient } from "pg";
import type {
  InboxRepository,
  InboxEventInput,
  InboxResult,
} from "@outboxy/db-adapter-core";
import { TABLE, INBOX_STATUS, MAX_ERROR_MESSAGE_LENGTH } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

type PgExecutor = Pool | PoolClient;

/**
 * PostgreSQL implementation of InboxRepository
 *
 * Uses raw SQL with ON CONFLICT DO NOTHING for atomic deduplication.
 * Accepts either Pool or PoolClient as executor to participate in
 * the caller's transaction.
 */
export class PgInboxRepository implements InboxRepository<PgExecutor> {
  /**
   * Receive and deduplicate an incoming event
   *
   * Uses ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
   * If RETURNING returns a row: new event (process it)
   * If RETURNING returns nothing: duplicate (skip it)
   */
  async receive(
    event: InboxEventInput,
    executor: PgExecutor,
  ): Promise<InboxResult> {
    return withErrorMapping(async () => {
      const result = await executor.query<{ id: string }>(
        `
        INSERT INTO ${TABLE.INBOX_EVENTS} (
          idempotency_key, source, aggregate_type, aggregate_id,
          event_type, event_version, payload, headers, metadata, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
        `,
        [
          event.idempotencyKey,
          event.source ?? null,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.eventVersion ?? 1,
          JSON.stringify(event.payload),
          JSON.stringify(event.headers ?? {}),
          JSON.stringify(event.metadata ?? {}),
          INBOX_STATUS.PROCESSED,
        ],
      );

      if (result.rows.length === 0) {
        return { eventId: null, status: "duplicate" };
      }

      return { eventId: result.rows[0]!.id, status: "processed" };
    });
  }

  /**
   * Bulk receive for batch processing
   *
   * Inserts all events in a single query with ON CONFLICT DO NOTHING.
   * Returns results with individual duplicate detection by querying
   * the table after insert.
   */
  async receiveBatch(
    events: InboxEventInput[],
    executor: PgExecutor,
  ): Promise<InboxResult[]> {
    if (events.length === 0) {
      return [];
    }

    return withErrorMapping(async () => {
      // Build bulk INSERT with VALUES clauses
      const valuesClauses: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      for (const event of events) {
        valuesClauses.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9})`,
        );
        params.push(
          event.idempotencyKey,
          event.source ?? null,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.eventVersion ?? 1,
          JSON.stringify(event.payload),
          JSON.stringify(event.headers ?? {}),
          JSON.stringify(event.metadata ?? {}),
          INBOX_STATUS.PROCESSED,
        );
        paramIndex += 10;
      }

      const insertSql = `
        INSERT INTO ${TABLE.INBOX_EVENTS} (
          idempotency_key, source, aggregate_type, aggregate_id,
          event_type, event_version, payload, headers, metadata, status
        ) VALUES ${valuesClauses.join(", ")}
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;

      const result = await executor.query<{ id: string }>(insertSql, params);

      // Build set of inserted IDs
      const insertedIds = new Set(result.rows.map((r) => r.id));

      // Query to map idempotency keys to IDs
      const idempotencyKeys = events.map((e) => e.idempotencyKey);
      const checkResult = await executor.query<{
        id: string;
        idempotency_key: string;
      }>(
        `SELECT id, idempotency_key FROM ${TABLE.INBOX_EVENTS} WHERE idempotency_key = ANY($1)`,
        [idempotencyKeys],
      );

      const keyToId = new Map(
        checkResult.rows.map((r) => [r.idempotency_key, r.id]),
      );

      return events.map((event) => {
        const eventId = keyToId.get(event.idempotencyKey);
        if (!eventId) {
          throw new Error(
            `Inbox event with idempotency_key '${event.idempotencyKey}' not found after INSERT ON CONFLICT DO NOTHING`,
          );
        }
        const wasInserted = insertedIds.has(eventId);
        return {
          eventId,
          status: wasInserted ? ("processed" as const) : ("duplicate" as const),
        };
      });
    });
  }

  /**
   * Mark an event as failed (for business-logic failures)
   *
   * Updates status to 'failed' and records the error message.
   * The event remains in the inbox (dedup still active).
   */
  async markFailed(
    eventId: string,
    error: string,
    executor: PgExecutor,
  ): Promise<void> {
    return withErrorMapping(async () => {
      await executor.query(
        `
        UPDATE ${TABLE.INBOX_EVENTS}
        SET status = $2,
            error = $3,
            processed_at = NOW()
        WHERE id = $1
        `,
        [
          eventId,
          INBOX_STATUS.FAILED,
          error.substring(0, MAX_ERROR_MESSAGE_LENGTH),
        ],
      );
    });
  }

  /**
   * Remove processed events older than retention days
   *
   * Deletes events with status='processed' where processed_at is older
   * than the specified retention period.
   */
  async cleanupProcessedEvents(
    retentionDays: number,
    executor: PgExecutor,
  ): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("retentionDays must be a positive integer");
    }

    return withErrorMapping(async () => {
      const result = await executor.query(
        `
        DELETE FROM ${TABLE.INBOX_EVENTS}
        WHERE status = $1
          AND processed_at < NOW() - ($2 * interval '1 day')
        `,
        [INBOX_STATUS.PROCESSED, retentionDays],
      );

      return result.rowCount ?? 0;
    });
  }
}
