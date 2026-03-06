import type { Pool } from "pg";
import type {
  EventRepository,
  BackoffConfig,
  OutboxEvent,
  OutboxEventRow,
} from "@outboxy/db-adapter-core";
import type { DestinationType } from "@outboxy/schema";
import { withErrorMapping } from "../errors.js";

/**
 * PostgreSQL implementation of EventRepository
 *
 * Uses raw SQL for all operations due to PostgreSQL-specific features
 * (FOR UPDATE SKIP LOCKED, power() function, CASE statements).
 */
export class PgEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Claim pending events for processing using SKIP LOCKED
   *
   * CRITICAL: Uses FOR UPDATE SKIP LOCKED to prevent race conditions
   * between concurrent workers.
   */
  async claimPendingEvents(batchSize: number): Promise<OutboxEvent[]> {
    return withErrorMapping(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `
          UPDATE outbox_events
          SET status = 'processing',
              processing_started_at = NOW(),
              updated_at = NOW()
          WHERE id IN (
            SELECT id
            FROM outbox_events
            WHERE status IN ('pending', 'failed')
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *
          `,
          [batchSize],
        );

        return result.rows.map((row: OutboxEventRow) =>
          this.mapRowToEvent(row),
        );
      } finally {
        client.release();
      }
    });
  }

  /**
   * Get count of pending events for adaptive polling
   */
  async getPendingEventCount(): Promise<number> {
    return withErrorMapping(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `
          SELECT COUNT(*) as count
          FROM outbox_events
          WHERE status IN ('pending', 'failed')
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
            AND deleted_at IS NULL
          `,
        );

        return Number(result.rows[0]?.count || 0);
      } finally {
        client.release();
      }
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
      const client = await this.pool.connect();
      try {
        const eventIds = results.map((r) => r.eventId);
        const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");

        // Build CASE statement for processed_by_worker
        let caseStatement = "CASE id";
        const params: string[] = [...eventIds];
        results.forEach((r, i) => {
          params.push(r.workerId);
          caseStatement += ` WHEN $${i + 1} THEN $${eventIds.length + i + 1}`;
        });
        caseStatement += " END";

        await client.query(
          `
          UPDATE outbox_events
          SET status = 'succeeded',
              processed_at = NOW(),
              updated_at = NOW(),
              processed_by_worker = ${caseStatement}
          WHERE id IN (${placeholders})
          `,
          params,
        );
      } finally {
        client.release();
      }
    });
  }

  /**
   * Schedule retries with server-side exponential backoff calculation
   */
  async scheduleRetry(
    eventIds: string[],
    errorMessages: Map<string, string>,
    config: BackoffConfig,
  ): Promise<void> {
    if (eventIds.length === 0) return;

    return withErrorMapping(async () => {
      const client = await this.pool.connect();
      try {
        const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");

        // Build CASE statement for last_error
        let errorCase = "CASE id";
        const params: (string | number)[] = [...eventIds];

        eventIds.forEach((id, i) => {
          const errorMsg = (errorMessages.get(id) ?? "Unknown error").substring(
            0,
            1000,
          );
          params.push(errorMsg);
          errorCase += ` WHEN $${i + 1} THEN $${eventIds.length + i + 1}`;
        });
        errorCase += " END";

        // Add backoff config params
        const backoffBaseIdx = params.length + 1;
        const backoffMultIdx = params.length + 2;
        params.push(config.backoffBaseMs, config.backoffMultiplier);

        await client.query(
          `
          UPDATE outbox_events
          SET status = 'failed',
              retry_count = retry_count + 1,
              last_error = ${errorCase},
              updated_at = NOW(),
              next_retry_at = NOW() + ($${backoffBaseIdx} * power($${backoffMultIdx}, retry_count)) * interval '1 millisecond'
          WHERE id IN (${placeholders})
            AND retry_count < max_retries
          `,
          params,
        );
      } finally {
        client.release();
      }
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

    return withErrorMapping(async () => {
      const client = await this.pool.connect();
      try {
        const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");

        // Build CASE statement for last_error
        let errorCase = "CASE id";
        const params: string[] = [...eventIds];

        eventIds.forEach((id, i) => {
          const errorMsg = (errorMessages.get(id) ?? "Unknown error").substring(
            0,
            1000,
          );
          params.push(errorMsg);
          errorCase += ` WHEN $${i + 1} THEN $${eventIds.length + i + 1}`;
        });
        errorCase += " END";

        await client.query(
          `
          UPDATE outbox_events
          SET status = 'dlq',
              last_error = ${errorCase},
              processed_at = NOW(),
              updated_at = NOW()
          WHERE id IN (${placeholders})
          `,
          params,
        );
      } finally {
        client.release();
      }
    });
  }

  /**
   * Map snake_case database row to camelCase domain model
   */
  private mapRowToEvent(row: OutboxEventRow): OutboxEvent {
    return {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: row.payload,
      headers: row.headers,
      destinationUrl: row.destination_url,
      destinationType: row.destination_type as DestinationType,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at,
      backoffMultiplier: row.backoff_multiplier,
      lastError: row.last_error,
      errorDetails: row.error_details,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      processingStartedAt: row.processing_started_at,
      processedAt: row.processed_at,
      metadata: row.metadata,
      processedByWorker: row.processed_by_worker,
      deletedAt: row.deleted_at,
      createdDate: row.created_date,
    };
  }
}
