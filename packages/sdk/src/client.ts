/**
 * Outboxy SDK Client
 *
 * Main client class for publishing events to the outbox table.
 *
 * @packageDocumentation
 */

import { propagation, context } from "@opentelemetry/api";
import type { SqlDialect } from "@outboxy/dialect-core";
import { COLUMNS, STATUS } from "@outboxy/schema";
import {
  OutboxyValidationError,
  OutboxyConnectionError,
  isConnectionError,
} from "./errors.js";
import type {
  OutboxyConfig,
  PublishEventInput,
  DestinationType,
  AdapterFn,
  QueryFn,
} from "./types.js";
import {
  safeStringify,
  validateFields,
  validateIdempotencyKey,
  validateDestinationType,
} from "./utilities.js";

/**
 * Outboxy SDK Client
 *
 * Simplified client that publishes events to the outbox table.
 * User manages their own transactions - SDK just executes INSERT.
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 *
 * @example pg usage
 * ```typescript
 * import { Pool, PoolClient } from 'pg';
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { PostgreSqlDialect } from '@outboxy/dialect-postgres';
 *
 * const pool = new Pool({ connectionString: DATABASE_URL });
 *
 * // Create client with pg adapter
 * const outboxy = new OutboxyClient<PoolClient>({
 *   dialect: new PostgreSqlDialect(),
 *   adapter: (client) => async (sql, params) => {
 *     const result = await client.query(sql, params);
 *     return result.rows as { id: string }[];
 *   },
 *   defaultDestinationUrl: 'https://webhook.example.com',
 * });
 *
 * // User manages transaction
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT INTO orders ...');
 *   await outboxy.publish({ ... }, client);  // Pass executor
 *   await client.query('COMMIT');
 * } catch (error) {
 *   await client.query('ROLLBACK');
 *   throw error;
 * } finally {
 *   client.release();
 * }
 * ```
 *
 * @example mysql usage
 * ```typescript
 * import { createPool, Pool } from 'mysql2/promise';
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { MySqlDialect } from '@outboxy/dialect-mysql';
 *
 * const pool = createPool({ uri: DATABASE_URL });
 *
 * const outboxy = new OutboxyClient({
 *   dialect: new MySqlDialect(),
 *   adapter: (conn) => async (sql, params) => {
 *     const [result] = await conn.execute(sql, params);
 *     if (!Array.isArray(result)) {
 *       // Write operations: return [{id:''}] for success, [] for INSERT IGNORE duplicates
 *       return result.affectedRows > 0 ? [{ id: "" }] : [];
 *     }
 *     return result as { id: string }[];
 *   },
 *   defaultDestinationUrl: 'https://webhook.example.com',
 * });
 * ```
 */
export class OutboxyClient<T> {
  private readonly adapter: AdapterFn<T>;
  private readonly dialect: SqlDialect;
  private readonly defaultDestinationUrl?: string;
  private readonly defaultDestinationType: DestinationType;
  private readonly defaultMaxRetries: number;
  private readonly defaultHeaders: Record<string, unknown>;
  private readonly defaultMetadata: Record<string, unknown>;

  constructor(config: OutboxyConfig<T>) {
    this.adapter = config.adapter;
    this.dialect = config.dialect;
    this.defaultDestinationUrl = config.defaultDestinationUrl;
    this.defaultMaxRetries = config.defaultMaxRetries ?? 5;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.defaultMetadata = config.defaultMetadata ?? {};

    // Validate and store default destination type
    const destinationType = config.defaultDestinationType ?? "http";
    validateDestinationType(destinationType);
    this.defaultDestinationType = destinationType;
  }

  /**
   * Publish an event to the outbox
   *
   * @param event - Event to publish
   * @param executor - Database executor (transaction client, pool, etc.)
   * @returns Event ID
   *
   * @throws OutboxyValidationError if validation fails
   * @throws OutboxyConnectionError if database connection fails
   *
   * @remarks
   * For PostgreSQL, duplicate idempotency keys are handled silently via
   * `ON CONFLICT DO UPDATE ... RETURNING id`. A second publish with the same
   * key returns the **same event ID** as the first — no error is thrown.
   *
   * @example
   * ```typescript
   * await outboxy.publish(
   *   {
   *     aggregateType: "Order",
   *     aggregateId: "123",
   *     eventType: "OrderCreated",
   *     payload: { orderId: "123", total: 100 },
   *     idempotencyKey: "order-123", // Optional: prevents duplicates
   *   },
   *   client,
   * );
   * ```
   *
   * @remarks
   * **MySQL Idempotency Key Limitations:**
   * Unlike PostgreSQL, MySQL does not support partial unique indexes.
   * This means idempotency keys cannot be reused after the original event succeeds.
   * Use unique keys that include timestamps or UUIDs when using MySQL.
   */
  async publish<TPayload = Record<string, unknown>>(
    event: PublishEventInput<TPayload>,
    executor: T,
  ): Promise<string> {
    const destinationUrl = event.destinationUrl || this.defaultDestinationUrl;

    if (!destinationUrl) {
      throw new OutboxyValidationError(
        "destinationUrl is required (provide in event or set defaultDestinationUrl in config)",
        "destinationUrl",
      );
    }

    // Resolve destination type with fallback chain
    const destinationType =
      event.destinationType ?? this.defaultDestinationType;

    // Validate destination type
    validateDestinationType(destinationType);

    // Validate fields
    validateFields(event);

    const maxRetries = event.maxRetries ?? this.defaultMaxRetries;
    const eventVersion = event.eventVersion ?? 1;
    const rawHeaders = event.headers ?? this.defaultHeaders;
    const headers: Record<string, unknown> = { ...rawHeaders };
    propagation.inject(context.active(), headers);
    const metadata = event.metadata ?? this.defaultMetadata;

    // Validate idempotency key (if provided)
    if (event.idempotencyKey !== undefined && event.idempotencyKey !== null) {
      validateIdempotencyKey(event.idempotencyKey);
    }

    const query = this.adapter(executor);

    // Pre-generate ID for databases without RETURNING
    const generatedId = this.dialect.supportsReturning
      ? undefined
      : crypto.randomUUID();

    const baseColumns = [
      COLUMNS.AGGREGATE_TYPE,
      COLUMNS.AGGREGATE_ID,
      COLUMNS.EVENT_TYPE,
      COLUMNS.EVENT_VERSION,
      COLUMNS.PAYLOAD,
      COLUMNS.HEADERS,
      COLUMNS.DESTINATION_URL,
      COLUMNS.DESTINATION_TYPE,
      COLUMNS.IDEMPOTENCY_KEY,
      COLUMNS.MAX_RETRIES,
      COLUMNS.METADATA,
      COLUMNS.STATUS,
    ];
    const baseValues = [
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      eventVersion,
      safeStringify(event.payload, "payload"),
      safeStringify(headers, "headers"),
      destinationUrl,
      destinationType,
      event.idempotencyKey || null,
      maxRetries,
      safeStringify(metadata, "metadata"),
      STATUS.PENDING,
    ];

    const columns = this.dialect.supportsReturning
      ? baseColumns
      : [COLUMNS.ID, ...baseColumns];
    const values = this.dialect.supportsReturning
      ? baseValues
      : [generatedId, ...baseValues];

    try {
      const statement = this.dialect.buildInsert({
        columns,
        values,
        generatedId,
      });

      const rows = await query(statement.sql, statement.params);

      // PostgreSQL: ID from RETURNING, MySQL: pre-generated ID
      if (this.dialect.supportsReturning) {
        const row = rows[0];
        if (!row) {
          throw new Error(
            "INSERT with RETURNING produced no rows — unexpected conflict state",
          );
        }
        return row.id;
      } else {
        return generatedId!;
      }
    } catch (error) {
      if (isConnectionError(error)) {
        throw new OutboxyConnectionError(
          "Database connection failed while publishing event",
          error as Error,
        );
      }
      throw error;
    }
  }

  /**
   * Publish multiple events in a single database round-trip
   *
   * Uses a bulk INSERT for optimal performance. Handles idempotency keys
   * via ON CONFLICT clause.
   *
   * @param events - Array of events to publish
   * @param executor - Database executor (transaction client, pool, etc.)
   * @returns Array of event IDs (in same order as input events)
   *
   * @throws OutboxyValidationError if any event fails validation
   * @throws OutboxyValidationError if duplicate idempotency keys in batch
   */
  async publishBatch<TPayload = Record<string, unknown>>(
    events: PublishEventInput<TPayload>[],
    executor: T,
  ): Promise<string[]> {
    if (events.length === 0) {
      return [];
    }

    const validatedEvents = events.map((event, index) => {
      const destinationUrl = event.destinationUrl || this.defaultDestinationUrl;
      if (!destinationUrl) {
        throw new OutboxyValidationError(
          `destinationUrl is required for event at index ${index}`,
          "destinationUrl",
        );
      }

      // Resolve and validate destination type for this event
      const destinationType =
        event.destinationType ?? this.defaultDestinationType;

      validateDestinationType(destinationType);

      validateFields(event);

      if (event.idempotencyKey !== undefined && event.idempotencyKey !== null) {
        validateIdempotencyKey(event.idempotencyKey);
      }

      return {
        ...event,
        destinationUrl,
        destinationType,
        maxRetries: event.maxRetries ?? this.defaultMaxRetries,
        eventVersion: event.eventVersion ?? 1,
        headers: event.headers ?? this.defaultHeaders,
        metadata: event.metadata ?? this.defaultMetadata,
      };
    });

    const keysInBatch = validatedEvents
      .map((e) => e.idempotencyKey)
      .filter((k): k is string => !!k);

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
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      eventVersion: number;
      payload: TPayload;
      headers: Record<string, unknown>;
      destinationUrl: string;
      destinationType: DestinationType;
      idempotencyKey?: string;
      maxRetries: number;
      metadata: Record<string, unknown>;
    }>,
    query: QueryFn,
  ): Promise<string[]> {
    const MAX_EVENTS_PER_BATCH = Math.floor(
      this.dialect.maxParameters / (this.dialect.supportsReturning ? 12 : 13),
    );

    // Handle large batches by chunking
    if (events.length > MAX_EVENTS_PER_BATCH) {
      const results: string[] = [];
      for (let i = 0; i < events.length; i += MAX_EVENTS_PER_BATCH) {
        const chunk = events.slice(i, i + MAX_EVENTS_PER_BATCH);
        const chunkIds = await this.bulkInsert(chunk, query);
        results.push(...chunkIds);
      }
      return results;
    }

    // Pre-generate IDs for databases without RETURNING
    const generatedIds = this.dialect.supportsReturning
      ? undefined
      : events.map(() => crypto.randomUUID());

    const baseColumns = [
      COLUMNS.AGGREGATE_TYPE,
      COLUMNS.AGGREGATE_ID,
      COLUMNS.EVENT_TYPE,
      COLUMNS.EVENT_VERSION,
      COLUMNS.PAYLOAD,
      COLUMNS.HEADERS,
      COLUMNS.DESTINATION_URL,
      COLUMNS.DESTINATION_TYPE,
      COLUMNS.IDEMPOTENCY_KEY,
      COLUMNS.MAX_RETRIES,
      COLUMNS.METADATA,
      COLUMNS.STATUS,
    ];
    const columns = this.dialect.supportsReturning
      ? baseColumns
      : [COLUMNS.ID, ...baseColumns];

    // Build rows
    const rows = events.map((event, index) => {
      const headersWithTrace: Record<string, unknown> = { ...event.headers };
      propagation.inject(context.active(), headersWithTrace);

      const baseValues = [
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.eventVersion,
        safeStringify(event.payload, "payload"),
        safeStringify(headersWithTrace, "headers"),
        event.destinationUrl,
        event.destinationType,
        event.idempotencyKey || null,
        event.maxRetries,
        safeStringify(event.metadata, "metadata"),
        STATUS.PENDING,
      ];

      return this.dialect.supportsReturning
        ? baseValues
        : [generatedIds![index], ...baseValues];
    });

    try {
      const statement = this.dialect.buildBulkInsert({
        columns,
        rows,
        generatedIds,
      });

      const resultRows = await query(statement.sql, statement.params);

      // PostgreSQL: IDs from RETURNING, MySQL: pre-generated IDs
      return this.dialect.supportsReturning
        ? resultRows.map((row) => row.id)
        : generatedIds!;
    } catch (error) {
      if (isConnectionError(error)) {
        throw new OutboxyConnectionError(
          "Database connection failed while inserting events",
          error as Error,
        );
      }
      throw error;
    }
  }
}

/**
 * Create an Outboxy client instance
 *
 * Convenience function for creating a client.
 *
 * @param config - Client configuration
 * @returns Configured Outboxy client
 */
export function createClient<T>(config: OutboxyConfig<T>): OutboxyClient<T> {
  return new OutboxyClient(config);
}
