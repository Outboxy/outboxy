import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import type {
  EventService,
  CreateEventInput,
  EventServiceResult,
  ReplayEventResult,
  ReplayRangeInput,
  ReplayRangeResult,
  OutboxEvent,
} from "@outboxy/db-adapter-core";
import { mapRowToEvent } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

interface EventRow extends RowDataPacket {
  id: string;
  status: string;
  created_at: Date;
}

interface StatusRow extends RowDataPacket {
  status: string;
}

interface IdRow extends RowDataPacket {
  id: string;
}

/**
 * MySQL implementation of EventService
 *
 * Uses raw SQL since MySQL doesn't support RETURNING.
 * Inserts require a separate SELECT to get the inserted data.
 */
export class MySQLEventService implements EventService {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new outbox event
   */
  async createEvent(input: CreateEventInput): Promise<EventServiceResult> {
    return withErrorMapping(async () => {
      const id = crypto.randomUUID();
      const now = new Date();

      await this.pool.execute(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, event_version,
          payload, headers, destination_url, destination_type,
          idempotency_key, max_retries, metadata, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `,
        [
          id,
          input.aggregateType,
          input.aggregateId,
          input.eventType,
          input.eventVersion ?? 1,
          JSON.stringify(input.payload),
          JSON.stringify(input.headers ?? {}),
          input.destinationUrl,
          input.destinationType ?? "http",
          input.idempotencyKey ?? null,
          input.maxRetries ?? 5,
          JSON.stringify(input.metadata ?? {}),
          now,
          now,
        ],
      );

      return {
        id,
        status: "pending",
        createdAt: now,
      };
    });
  }

  /**
   * Get event by ID (respects soft deletes)
   */
  async getEventById(id: string): Promise<OutboxEvent | null> {
    return withErrorMapping(async () => {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `
        SELECT * FROM outbox_events
        WHERE id = ? AND deleted_at IS NULL
        `,
        [id],
      );

      if (rows.length === 0) {
        return null;
      }

      return mapRowToEvent(rows[0] as Parameters<typeof mapRowToEvent>[0]);
    });
  }

  /**
   * Find event by idempotency key (non-succeeded events only)
   */
  async findByIdempotencyKey(key: string): Promise<EventServiceResult | null> {
    return withErrorMapping(async () => {
      const [rows] = await this.pool.execute<EventRow[]>(
        `
        SELECT id, status, created_at
        FROM outbox_events
        WHERE idempotency_key = ?
          AND status != 'succeeded'
          AND deleted_at IS NULL
        `,
        [key],
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        id: rows[0]!.id,
        status: rows[0]!.status,
        createdAt: rows[0]!.created_at,
      };
    });
  }

  /**
   * Replay a single failed/dlq event
   */
  async replayEvent(id: string): Promise<ReplayEventResult | null> {
    return withErrorMapping(async () => {
      // Get current status
      const [statusRows] = await this.pool.execute<StatusRow[]>(
        `
        SELECT status FROM outbox_events
        WHERE id = ? AND deleted_at IS NULL
        `,
        [id],
      );

      if (statusRows.length === 0) {
        return null;
      }

      const previousStatus = statusRows[0]!.status;

      // Only replay failed or dlq events
      if (previousStatus !== "failed" && previousStatus !== "dlq") {
        return null;
      }

      const [result] = await this.pool.execute<ResultSetHeader>(
        `
        UPDATE outbox_events
        SET status = 'pending',
            retry_count = 0,
            next_retry_at = NULL,
            last_error = NULL,
            error_details = NULL,
            processing_started_at = NULL,
            processed_at = NULL,
            updated_at = NOW()
        WHERE id = ?
          AND status IN ('failed', 'dlq')
          AND deleted_at IS NULL
        `,
        [id],
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return {
        id,
        previousStatus,
        newStatus: "pending",
        replayedAt: new Date(),
      };
    });
  }

  /**
   * Replay multiple events within a date range
   */
  async replayEventsInRange(
    input: ReplayRangeInput,
  ): Promise<ReplayRangeResult> {
    return withErrorMapping(async () => {
      const status = input.status ?? "dlq";
      const limit = input.limit ?? 100;

      const params: unknown[] = [status, input.startDate, input.endDate];
      let query = `
        SELECT id FROM outbox_events
        WHERE status = ?
          AND created_at >= ?
          AND created_at <= ?
          AND deleted_at IS NULL
      `;

      if (input.aggregateType) {
        query += ` AND aggregate_type = ?`;
        params.push(input.aggregateType);
      }

      // LIMIT must be interpolated directly since MySQL prepared statements
      // don't support parameterized LIMIT. Safe since limit is always a number.
      query += ` LIMIT ${Number(limit)}`;

      const [idsRows] = await this.pool.execute<IdRow[]>(query, params);

      if (idsRows.length === 0) {
        return { replayedCount: 0, eventIds: [] };
      }

      const eventIds = idsRows.map((row) => row.id);
      const placeholders = eventIds.map(() => "?").join(",");

      const [result] = await this.pool.execute<ResultSetHeader>(
        `
        UPDATE outbox_events
        SET status = 'pending',
            retry_count = 0,
            next_retry_at = NULL,
            last_error = NULL,
            error_details = NULL,
            processing_started_at = NULL,
            processed_at = NULL,
            updated_at = NOW()
        WHERE id IN (${placeholders})
        `,
        eventIds,
      );

      return {
        replayedCount: result.affectedRows,
        eventIds,
      };
    });
  }
}
