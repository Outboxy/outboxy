import type {
  Pool,
  PoolConnection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import type {
  InboxRepository,
  InboxEventInput,
  InboxResult,
} from "@outboxy/db-adapter-core";
import { TABLE, INBOX_STATUS, MAX_ERROR_MESSAGE_LENGTH } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

type MySqlExecutor = Pool | PoolConnection;

interface IdRow extends RowDataPacket {
  id: string;
  idempotency_key: string;
}

/**
 * MySQL implementation of InboxRepository
 *
 * Uses INSERT IGNORE for atomic deduplication. Since MySQL doesn't support
 * RETURNING, we check affectedRows to detect duplicates (0 = duplicate, 1 = inserted).
 * Requires pre-generated UUIDs for all inserts.
 */
export class MySqlInboxRepository implements InboxRepository<MySqlExecutor> {
  /**
   * Receive and deduplicate an incoming event
   *
   * Uses INSERT IGNORE which silently ignores rows that would cause duplicate
   * key errors. Check affectedRows (0 = duplicate, 1 = inserted).
   */
  async receive(
    event: InboxEventInput,
    executor: MySqlExecutor,
  ): Promise<InboxResult> {
    return withErrorMapping(async () => {
      // Pre-generate UUID since MySQL doesn't support RETURNING
      const generatedId = crypto.randomUUID();

      const [result] = await executor.execute<ResultSetHeader>(
        `
        INSERT IGNORE INTO ${TABLE.INBOX_EVENTS} (
          id, idempotency_key, source, aggregate_type, aggregate_id,
          event_type, event_version, payload, headers, metadata, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          generatedId,
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

      if (result.affectedRows === 0) {
        // INSERT IGNORE triggered - duplicate
        return { eventId: null, status: "duplicate" };
      }

      return { eventId: generatedId, status: "processed" };
    });
  }

  /**
   * Bulk receive for batch processing
   *
   * Inserts all events in a single query with INSERT IGNORE.
   * After insert, queries the table to determine which were inserted vs duplicate.
   */
  async receiveBatch(
    events: InboxEventInput[],
    executor: MySqlExecutor,
  ): Promise<InboxResult[]> {
    if (events.length === 0) {
      return [];
    }

    return withErrorMapping(async () => {
      // Pre-generate UUIDs since MySQL doesn't support RETURNING
      const generatedIds = events.map(() => crypto.randomUUID());

      // Build bulk INSERT IGNORE with VALUES clauses
      const valuesClauses: string[] = [];
      const params: unknown[] = [];

      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        valuesClauses.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        params.push(
          generatedIds[i],
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
      }

      const insertSql = `
        INSERT IGNORE INTO ${TABLE.INBOX_EVENTS} (
          id, idempotency_key, source, aggregate_type, aggregate_id,
          event_type, event_version, payload, headers, metadata, status
        ) VALUES ${valuesClauses.join(", ")}
      `;

      await executor.execute<ResultSetHeader>(insertSql, params);

      // Query to map idempotency keys to IDs
      const idempotencyKeys = events.map((e) => e.idempotencyKey);
      const placeholders = idempotencyKeys.map(() => "?").join(",");

      const [existingRows] = await executor.execute<IdRow[]>(
        `SELECT id, idempotency_key FROM ${TABLE.INBOX_EVENTS} WHERE idempotency_key IN (${placeholders})`,
        idempotencyKeys,
      );

      const keyToId = new Map(
        existingRows.map((r) => [r.idempotency_key, r.id]),
      );

      return events.map((event, index) => {
        const generatedId = generatedIds[index]!;
        const existingId = keyToId.get(event.idempotencyKey);

        if (!existingId) {
          throw new Error(
            `Inbox event with idempotency_key '${event.idempotencyKey}' not found after INSERT IGNORE`,
          );
        }

        // If existing ID matches our generated ID, it was a new insert
        const wasInserted = existingId === generatedId;
        return {
          eventId: existingId,
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
    executor: MySqlExecutor,
  ): Promise<void> {
    return withErrorMapping(async () => {
      await executor.execute(
        `
        UPDATE ${TABLE.INBOX_EVENTS}
        SET status = ?,
            error = ?,
            processed_at = NOW()
        WHERE id = ?
        `,
        [
          INBOX_STATUS.FAILED,
          error.substring(0, MAX_ERROR_MESSAGE_LENGTH),
          eventId,
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
    executor: MySqlExecutor,
  ): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error("retentionDays must be a positive integer");
    }

    return withErrorMapping(async () => {
      const [result] = await executor.execute<ResultSetHeader>(
        `
        DELETE FROM ${TABLE.INBOX_EVENTS}
        WHERE status = ?
          AND processed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `,
        [INBOX_STATUS.PROCESSED, retentionDays],
      );

      return result.affectedRows;
    });
  }
}
