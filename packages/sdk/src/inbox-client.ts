/**
 * Inboxy SDK Client
 *
 * Client class for receiving and deduplicating incoming events.
 *
 * @packageDocumentation
 */

import type { InboxSqlDialect } from "@outboxy/dialect-core";
import {
  INBOX_COLUMNS,
  INBOX_STATUS,
  MAX_ERROR_MESSAGE_LENGTH,
} from "@outboxy/schema";
import {
  OutboxyValidationError,
  OutboxyConnectionError,
  isConnectionError,
} from "./errors.js";
import type {
  InboxyConfig,
  InboxReceiveEventInput,
  InboxReceiveResult,
} from "./inbox-types.js";
import type { AdapterFn, QueryFn } from "./types.js";
import { safeStringify, validateIdempotencyKey } from "./utilities.js";

interface IdempotencyKeyRow {
  id: string;
  idempotency_key: string;
}

/**
 * Validate inbox event fields
 *
 * @internal
 */
function validateInboxFields<TPayload>(
  event: InboxReceiveEventInput<TPayload>,
): void {
  if (event.eventVersion !== undefined) {
    if (!Number.isInteger(event.eventVersion) || event.eventVersion < 1) {
      throw new OutboxyValidationError(
        "eventVersion must be a positive integer",
        "eventVersion",
      );
    }
  }
}

/**
 * Inboxy SDK Client
 *
 * Client for receiving and deduplicating incoming events using the inbox pattern.
 * User manages their own transactions - SDK just executes INSERT with ON CONFLICT DO NOTHING.
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 *
 * @example PostgreSQL usage
 * ```typescript
 * import { Pool, PoolClient } from 'pg';
 * import { InboxyClient } from '@outboxy/sdk';
 * import { PostgreSqlInboxDialect } from '@outboxy/dialect-postgres';
 *
 * const pool = new Pool({ connectionString: DATABASE_URL });
 *
 * // Create client with pg adapter
 * const inbox = new InboxyClient<PoolClient>({
 *   dialect: new PostgreSqlInboxDialect(),
 *   adapter: (client) => async (sql, params) => {
 *     const result = await client.query(sql, params);
 *     return result.rows as { id: string }[];
 *   },
 * });
 *
 * // User manages transaction
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *   const result = await inbox.receive({ ... }, client);
 *   if (result.status === 'duplicate') {
 *     await client.query('COMMIT');
 *     return; // Already processed
 *   }
 *   // Your business logic here
 *   await client.query('COMMIT');
 * } catch (error) {
 *   await client.query('ROLLBACK');
 *   throw error;
 * } finally {
 *   client.release();
 * }
 * ```
 */
export class InboxyClient<T> {
  private static readonly INBOX_BASE_COLUMNS = [
    INBOX_COLUMNS.IDEMPOTENCY_KEY,
    INBOX_COLUMNS.SOURCE,
    INBOX_COLUMNS.AGGREGATE_TYPE,
    INBOX_COLUMNS.AGGREGATE_ID,
    INBOX_COLUMNS.EVENT_TYPE,
    INBOX_COLUMNS.EVENT_VERSION,
    INBOX_COLUMNS.PAYLOAD,
    INBOX_COLUMNS.HEADERS,
    INBOX_COLUMNS.METADATA,
    INBOX_COLUMNS.STATUS,
  ] as const;

  private readonly adapter: AdapterFn<T>;
  private readonly dialect: InboxSqlDialect;
  private readonly defaultHeaders: Record<string, unknown>;
  private readonly defaultMetadata: Record<string, unknown>;

  constructor(config: InboxyConfig<T>) {
    this.adapter = config.adapter;
    this.dialect = config.dialect;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.defaultMetadata = config.defaultMetadata ?? {};
  }

  /**
   * Receive and deduplicate an incoming event
   *
   * Inserts a record into inbox_events within the caller's transaction.
   * If the idempotency_key already exists, returns { status: 'duplicate' }.
   * If new, returns { status: 'processed', eventId: '...' }.
   *
   * MUST be called within an active database transaction for atomicity.
   *
   * @param event - Event to receive (idempotencyKey is REQUIRED)
   * @param executor - Database executor (transaction client, pool, etc.)
   * @returns Result indicating processed or duplicate status
   *
   * @throws OutboxyValidationError if validation fails
   * @throws OutboxyConnectionError if database connection fails
   *
   * @example
   * ```typescript
   * const result = await inbox.receive(
   *   {
   *     idempotencyKey: 'order-123-created',
   *     aggregateType: 'Order',
   *     aggregateId: '123',
   *     eventType: 'OrderCreated',
   *     payload: { orderId: '123', total: 100 },
   *   },
   *   client,
   * );
   *
   * if (result.status === 'duplicate') {
   *   // Event already processed, skip business logic
   *   return;
   * }
   * // Process new event
   * ```
   */
  async receive<TPayload = Record<string, unknown>>(
    event: InboxReceiveEventInput<TPayload>,
    executor: T,
  ): Promise<InboxReceiveResult> {
    // idempotencyKey is REQUIRED for inbox (unlike outbox where it's optional)
    if (!event.idempotencyKey) {
      throw new OutboxyValidationError(
        "idempotencyKey is required for inbox.receive()",
        "idempotencyKey",
      );
    }

    validateIdempotencyKey(event.idempotencyKey);
    validateInboxFields(event);

    const eventVersion = event.eventVersion ?? 1;
    const headers = event.headers ?? this.defaultHeaders;
    const metadata = event.metadata ?? this.defaultMetadata;

    const query = this.adapter(executor);

    // Pre-generate ID for databases without RETURNING
    const generatedId = this.dialect.supportsReturning
      ? undefined
      : crypto.randomUUID();

    const baseColumns = [...InboxyClient.INBOX_BASE_COLUMNS];
    const baseValues = [
      event.idempotencyKey,
      event.source ?? null,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      eventVersion,
      safeStringify(event.payload, "payload"),
      safeStringify(headers, "headers"),
      safeStringify(metadata, "metadata"),
      INBOX_STATUS.PROCESSED,
    ];

    const columns = this.dialect.supportsReturning
      ? baseColumns
      : [INBOX_COLUMNS.ID, ...baseColumns];
    const values = this.dialect.supportsReturning
      ? baseValues
      : [generatedId, ...baseValues];

    try {
      const statement = this.dialect.buildInboxInsert({
        columns,
        values,
        generatedId,
      });

      const rows = await query(statement.sql, statement.params);

      // PostgreSQL: RETURNING returns row if inserted, empty if duplicate
      // MySQL: affectedRows check is done by caller (not available in QueryFn)
      if (this.dialect.supportsReturning) {
        if (rows.length === 0) {
          return {
            eventId: null,
            status: "duplicate",
          };
        }
        return {
          eventId: rows[0]!.id,
          status: "processed",
        };
      } else {
        // MySQL: adapter returns [] for INSERT IGNORE duplicates (affectedRows=0),
        // [{id:''}] for successful inserts
        if (rows.length === 0) {
          return { eventId: generatedId!, status: "duplicate" };
        }
        return { eventId: generatedId!, status: "processed" };
      }
    } catch (error) {
      if (isConnectionError(error)) {
        throw new OutboxyConnectionError(
          "Database connection failed while receiving event",
          error as Error,
        );
      }
      throw error;
    }
  }

  /**
   * Receive multiple events in a single database round-trip
   *
   * Uses a bulk INSERT for optimal performance. Handles partial duplicates -
   * some events may be new, some may be duplicates.
   *
   * @param events - Array of events to receive (idempotencyKey is REQUIRED for each)
   * @param executor - Database executor (transaction client, pool, etc.)
   * @returns Array of results (in same order as input events)
   *
   * @throws OutboxyValidationError if any event fails validation
   * @throws OutboxyValidationError if duplicate idempotency keys in batch
   */
  async receiveBatch<TPayload = Record<string, unknown>>(
    events: InboxReceiveEventInput<TPayload>[],
    executor: T,
  ): Promise<InboxReceiveResult[]> {
    if (events.length === 0) {
      return [];
    }

    const validatedEvents = events.map((event, index) => {
      if (!event.idempotencyKey) {
        throw new OutboxyValidationError(
          `idempotencyKey is required for event at index ${index}`,
          "idempotencyKey",
        );
      }

      validateIdempotencyKey(event.idempotencyKey);
      validateInboxFields(event);

      return {
        ...event,
        eventVersion: event.eventVersion ?? 1,
        headers: event.headers ?? this.defaultHeaders,
        metadata: event.metadata ?? this.defaultMetadata,
      };
    });

    const keysInBatch = validatedEvents.map((e) => e.idempotencyKey);
    const uniqueKeys = new Set(keysInBatch);
    if (keysInBatch.length !== uniqueKeys.size) {
      throw new OutboxyValidationError(
        "Duplicate idempotency keys within batch are not allowed",
        "idempotencyKey",
      );
    }

    const query = this.adapter(executor);
    return this.bulkInsert(validatedEvents, query);
  }

  /**
   * Bulk insert events with a single query
   *
   * @internal
   */
  private async bulkInsert<TPayload>(
    events: Array<{
      idempotencyKey: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      eventVersion: number;
      payload: TPayload;
      source?: string;
      headers: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }>,
    query: QueryFn,
  ): Promise<InboxReceiveResult[]> {
    const MAX_EVENTS_PER_BATCH = Math.floor(
      this.dialect.maxParameters / (this.dialect.supportsReturning ? 10 : 11),
    );

    // Handle large batches by chunking
    if (events.length > MAX_EVENTS_PER_BATCH) {
      const results: InboxReceiveResult[] = [];
      for (let i = 0; i < events.length; i += MAX_EVENTS_PER_BATCH) {
        const chunk = events.slice(i, i + MAX_EVENTS_PER_BATCH);
        const chunkResults = await this.bulkInsert(chunk, query);
        results.push(...chunkResults);
      }
      return results;
    }

    // Pre-generate IDs for databases without RETURNING
    const generatedIds = this.dialect.supportsReturning
      ? undefined
      : events.map(() => crypto.randomUUID());

    const baseColumns = [...InboxyClient.INBOX_BASE_COLUMNS];
    const columns = this.dialect.supportsReturning
      ? baseColumns
      : [INBOX_COLUMNS.ID, ...baseColumns];

    // Build rows
    const rows = events.map((event, index) => {
      const baseValues = [
        event.idempotencyKey,
        event.source ?? null,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.eventVersion,
        safeStringify(event.payload, "payload"),
        safeStringify(event.headers, "headers"),
        safeStringify(event.metadata, "metadata"),
        INBOX_STATUS.PROCESSED,
      ];

      return this.dialect.supportsReturning
        ? baseValues
        : [generatedIds![index], ...baseValues];
    });

    try {
      const statement = this.dialect.buildInboxBulkInsert({
        columns,
        rows,
        generatedIds,
      });

      const resultRows = await query(statement.sql, statement.params);

      // Map back to input events to determine which were processed vs duplicate
      const insertedIds = this.dialect.supportsReturning
        ? new Set(resultRows.map((r) => r.id))
        : undefined;

      const keys = events.map((e) => e.idempotencyKey);
      const findStatement = this.dialect.buildFindByIdempotencyKeys({ keys });
      const checkRows = (await query(
        findStatement.sql,
        findStatement.params,
      )) as IdempotencyKeyRow[];

      const keyToId = new Map(checkRows.map((r) => [r.idempotency_key, r.id]));

      return events.map((event, index) => {
        const dbId = keyToId.get(event.idempotencyKey);
        if (this.dialect.supportsReturning) {
          if (!dbId) return { eventId: null, status: "duplicate" as const };
          return {
            eventId: dbId,
            status: insertedIds!.has(dbId)
              ? ("processed" as const)
              : ("duplicate" as const),
          };
        }
        const wasInserted = dbId === generatedIds![index];
        return {
          eventId: dbId ?? generatedIds![index]!,
          status: wasInserted ? ("processed" as const) : ("duplicate" as const),
        };
      });
    } catch (error) {
      if (isConnectionError(error)) {
        throw new OutboxyConnectionError(
          "Database connection failed while receiving events",
          error as Error,
        );
      }
      throw error;
    }
  }

  /**
   * Explicitly mark an inbox event as failed
   *
   * Use for business-logic failures that should be recorded but not retried.
   * The event remains in the inbox (dedup still active) but is flagged for
   * operational attention.
   *
   * @param eventId - ID of the event to mark as failed
   * @param error - Error message describing the failure
   * @param executor - Database executor (transaction client, pool, etc.)
   */
  async markFailed(eventId: string, error: string, executor: T): Promise<void> {
    const truncatedError = error.substring(0, MAX_ERROR_MESSAGE_LENGTH);
    const query = this.adapter(executor);
    const statement = this.dialect.buildMarkFailed({
      eventId,
      error: truncatedError,
    });

    try {
      await query(statement.sql, statement.params);
    } catch (err) {
      if (isConnectionError(err)) {
        throw new OutboxyConnectionError(
          "Database connection failed while marking event as failed",
          err as Error,
        );
      }
      throw err;
    }
  }
}

/**
 * Create an Inboxy client instance
 *
 * Convenience function for creating a client.
 *
 * @param config - Client configuration
 * @returns Configured Inboxy client
 */
export function createInboxClient<T>(config: InboxyConfig<T>): InboxyClient<T> {
  return new InboxyClient(config);
}
