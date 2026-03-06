import type { Pool } from "pg";
import type {
  EventService,
  CreateEventInput,
  EventServiceResult,
  ReplayEventResult,
  ReplayRangeInput,
  ReplayRangeResult,
  OutboxEvent,
} from "@outboxy/db-adapter-core";
import { mapRowToEvent, type OutboxEventRow } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

interface EventRow {
  id: string;
  status: string;
  created_at: Date;
}

interface StatusRow {
  status: string;
}

interface IdRow {
  id: string;
}

/**
 * PostgreSQL implementation of EventService using raw SQL
 *
 * Uses raw SQL with pg Pool directly, following the same pattern as MySQL.
 * PostgreSQL supports RETURNING clause so we can get inserted data in one query.
 */
export class PgEventService implements EventService {
  constructor(private readonly pool: Pool) {}

  /**
   * Create a new outbox event
   */
  async createEvent(input: CreateEventInput): Promise<EventServiceResult> {
    return withErrorMapping(async () => {
      const id = crypto.randomUUID();

      const result = await this.pool.query<{ created_at: Date }>(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, event_version,
          payload, headers, destination_url, destination_type,
          idempotency_key, max_retries, metadata, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', NOW(), NOW())
        RETURNING created_at
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
        ],
      );

      return { id, status: "pending", createdAt: result.rows[0]!.created_at };
    });
  }

  /**
   * Get event by ID (respects soft deletes)
   */
  async getEventById(id: string): Promise<OutboxEvent | null> {
    return withErrorMapping(async () => {
      const result = await this.pool.query<OutboxEventRow>(
        `
        SELECT * FROM outbox_events
        WHERE id = $1 AND deleted_at IS NULL
        `,
        [id],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return mapRowToEvent(result.rows[0]!);
    });
  }

  /**
   * Find event by idempotency key (non-succeeded events only)
   */
  async findByIdempotencyKey(key: string): Promise<EventServiceResult | null> {
    return withErrorMapping(async () => {
      const result = await this.pool.query<EventRow>(
        `
        SELECT id, status, created_at
        FROM outbox_events
        WHERE idempotency_key = $1
          AND status != 'succeeded'
          AND deleted_at IS NULL
        `,
        [key],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0]!;

      return {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
      };
    });
  }

  /**
   * Replay a single failed/dlq event
   */
  async replayEvent(id: string): Promise<ReplayEventResult | null> {
    return withErrorMapping(async () => {
      // Get current status
      const statusResult = await this.pool.query<StatusRow>(
        `
        SELECT status FROM outbox_events
        WHERE id = $1 AND deleted_at IS NULL
        `,
        [id],
      );

      if (statusResult.rows.length === 0) {
        return null;
      }

      const previousStatus = statusResult.rows[0]!.status;

      // Only replay failed or dlq events
      if (previousStatus !== "failed" && previousStatus !== "dlq") {
        return null;
      }

      const updateResult = await this.pool.query<IdRow>(
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
        WHERE id = $1
          AND status IN ('failed', 'dlq')
          AND deleted_at IS NULL
        RETURNING id
        `,
        [id],
      );

      if (updateResult.rows.length === 0) {
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
      let paramIndex = 4;
      let query = `
        SELECT id FROM outbox_events
        WHERE status = $1
          AND created_at >= $2
          AND created_at <= $3
          AND deleted_at IS NULL
      `;

      if (input.aggregateType) {
        query += ` AND aggregate_type = $${paramIndex}`;
        params.push(input.aggregateType);
        paramIndex++;
      }

      query += ` LIMIT $${paramIndex}`;
      params.push(limit);

      const idsResult = await this.pool.query<IdRow>(query, params);

      if (idsResult.rows.length === 0) {
        return { replayedCount: 0, eventIds: [] };
      }

      const eventIds = idsResult.rows.map((row) => row.id);

      // Build parameterized IN clause
      const inParams = eventIds.map((_, i) => `$${i + 1}`).join(",");

      const updateResult = await this.pool.query<IdRow>(
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
        WHERE id IN (${inParams})
        RETURNING id
        `,
        eventIds,
      );

      return {
        replayedCount: updateResult.rows.length,
        eventIds: updateResult.rows.map((row) => row.id),
      };
    });
  }
}
