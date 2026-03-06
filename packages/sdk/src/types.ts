/**
 * Outboxy SDK Type Definitions
 *
 * Type definitions and Zod schemas for the SDK.
 *
 * @packageDocumentation
 */

import { z } from "zod";
import type { SqlDialect } from "@outboxy/dialect-core";

/**
 * Valid destination types for event delivery
 *
 * Supports HTTP webhooks, Kafka topics, SQS queues, RabbitMQ exchanges, and GCP Pub/Sub topics.
 */
export const destinationTypeEnum = z.enum([
  "http",
  "kafka",
  "sqs",
  "rabbitmq",
  "pubsub",
]);

/**
 * Destination type for event delivery
 *
 * Determines which publisher the worker will use to deliver the event.
 * - "http": HTTP webhook (default)
 * - "kafka": Apache Kafka topic
 * - "sqs": AWS SQS queue
 * - "rabbitmq": RabbitMQ exchange
 * - "pubsub": GCP Pub/Sub topic
 */
export type DestinationType = z.infer<typeof destinationTypeEnum>;

/**
 * Function that executes SQL and returns inserted rows
 *
 * This is the common interface that all database executors must satisfy.
 * The SDK calls this function with SQL and parameters, expecting an array
 * of rows with at least an `id` field.
 */
export type QueryFn = (
  sql: string,
  params: unknown[],
) => Promise<{ id: string }[]>;

/**
 * Adapter function that converts a database executor to QueryFn
 *
 * Users provide this once at SDK initialization. The adapter knows how
 * to convert their specific executor type (PoolClient, Drizzle tx, etc.)
 * into the common QueryFn interface.
 *
 * @example pg adapter
 * ```typescript
 * const adapter = (client: PoolClient) => async (sql, params) => {
 *   const result = await client.query(sql, params);
 *   return result.rows as { id: string }[];
 * };
 * ```
 *
 * @example mysql2 adapter
 * ```typescript
 * const adapter = (conn: PoolConnection) => async (sql, params) => {
 *   const [result] = await conn.execute(sql, params);
 *   if (!Array.isArray(result)) {
 *     // Write operations: return [{id:''}] for success, [] for INSERT IGNORE duplicates
 *     return result.affectedRows > 0 ? [{ id: "" }] : [];
 *   }
 *   return result as { id: string }[];
 * };
 * ```
 */
export type AdapterFn<T> = (executor: T) => QueryFn;

/**
 * Outboxy client configuration
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 */
export interface OutboxyConfig<T> {
  /**
   * Adapter function that converts executor to QueryFn
   *
   * Configure this once - the SDK uses it for all publish calls.
   */
  adapter: AdapterFn<T>;

  /**
   * SQL dialect for database-specific SQL generation
   *
   * Required: Import from @outboxy/dialect-postgres or @outboxy/dialect-mysql
   *
   * @example PostgreSQL
   * ```typescript
   * import { PostgreSqlDialect } from '@outboxy/dialect-postgres';
   * const client = new OutboxyClient({ dialect: new PostgreSqlDialect(), ... });
   * ```
   *
   * @example MySQL
   * ```typescript
   * import { MySqlDialect } from '@outboxy/dialect-mysql';
   * const client = new OutboxyClient({ dialect: new MySqlDialect(), ... });
   * ```
   */
  dialect: SqlDialect;

  /**
   * Default destination URL for events (optional)
   *
   * Can be overridden per-event in publish() call.
   */
  defaultDestinationUrl?: string;

  /**
   * Default destination type for events (optional)
   *
   * Determines which publisher the worker will use. Can be overridden per-event.
   *
   * Valid values: "http", "kafka", "sqs", "rabbitmq", "pubsub"
   *
   * @default "http"
   */
  defaultDestinationType?: DestinationType;

  /**
   * Default max retries (optional)
   *
   * Default: 5
   */
  defaultMaxRetries?: number;

  /**
   * Default HTTP headers to include with each event (optional)
   *
   * Can be overridden per-event in publish() call.
   * Default: {}
   */
  defaultHeaders?: Record<string, unknown>;

  /**
   * Default metadata to include with each event (optional)
   *
   * Can be overridden per-event in publish() call.
   * Default: {}
   */
  defaultMetadata?: Record<string, unknown>;
}

/**
 * Event to publish
 *
 * @template TPayload - Type of the event payload (default: Record<string, unknown>)
 */
export interface PublishEventInput<TPayload = Record<string, unknown>> {
  /** Aggregate type (e.g., "Order", "User", "Payment") */
  aggregateType: string;

  /** Aggregate ID (e.g., order ID, user ID) */
  aggregateId: string;

  /** Event type (e.g., "OrderCreated", "UserUpdated") */
  eventType: string;

  /** Event payload data */
  payload: TPayload;

  /** Destination URL (uses defaultDestinationUrl if not provided) */
  destinationUrl?: string;

  /**
   * Destination type (uses defaultDestinationType if not provided, default: "http")
   *
   * Determines which publisher the worker will use to deliver this event.
   * Overrides the defaultDestinationType from config if specified.
   *
   * Valid values: "http", "kafka", "sqs", "rabbitmq", "pubsub"
   */
  destinationType?: DestinationType;

  /** Idempotency key for duplicate prevention */
  idempotencyKey?: string;

  /** Max retry attempts (uses defaultMaxRetries if not provided, default: 5) */
  maxRetries?: number;

  /** Event schema version (default: 1) */
  eventVersion?: number;

  /** HTTP headers to include with the event (default: {}) */
  headers?: Record<string, unknown>;

  /** Custom metadata for observability (default: {}). Can include tracing info like trace_id, span_id. */
  metadata?: Record<string, unknown>;
}
