/**
 * Inboxy SDK Type Definitions
 *
 * Type definitions for the InboxyClient.
 *
 * @packageDocumentation
 */

import type { InboxSqlDialect } from "@outboxy/dialect-core";
import type { AdapterFn } from "./types.js";

/**
 * Event to receive into the inbox
 *
 * Unlike outbox's PublishEventInput, idempotencyKey is REQUIRED for inbox.
 * The inbox exists specifically for deduplication.
 *
 * @template TPayload - Type of the event payload (default: Record<string, unknown>)
 */
export interface InboxReceiveEventInput<TPayload = Record<string, unknown>> {
  /**
   * REQUIRED. Unique key for deduplication.
   *
   * Consumer chooses the key strategy:
   * - Transport-level: `kafka:orders:${partition}:${offset}`
   * - Business-level: `order-${orderId}-created`
   * - Hybrid: `payment-svc:charge-${chargeId}`
   * - Outboxy event ID: use the outbox's own ID
   */
  idempotencyKey: string;

  /** Aggregate type (e.g., "Order", "User", "Payment") */
  aggregateType: string;

  /** Aggregate ID (e.g., order ID, user ID) */
  aggregateId: string;

  /** Event type (e.g., "OrderCreated", "UserUpdated") */
  eventType: string;

  /** Event payload data */
  payload: TPayload;

  /**
   * Optional. Source service/system for observability.
   *
   * Examples: "payment-service", "kafka:orders", "stripe-webhook"
   */
  source?: string;

  /** Event schema version (default: 1) */
  eventVersion?: number;

  /** HTTP headers from the incoming request (default: {}) */
  headers?: Record<string, unknown>;

  /** Custom metadata for observability (default: {}) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of inbox.receive() operation
 */
export interface InboxReceiveResult {
  /** Generated event ID (from inbox_events.id), null if duplicate on PG (no RETURNING) */
  eventId: string | null;

  /**
   * 'processed' = new event was inserted
   * 'duplicate' = event already exists (idempotency_key conflict)
   */
  status: "processed" | "duplicate";
}

/**
 * Inboxy client configuration
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 */
export interface InboxyConfig<T> {
  /**
   * Adapter function that converts executor to QueryFn
   *
   * Reuse the same adapter as OutboxyClient for shared transaction support.
   */
  adapter: AdapterFn<T>;

  /**
   * SQL dialect for inbox-specific database operations
   *
   * Import from @outboxy/dialect-postgres or @outboxy/dialect-mysql
   *
   * @example PostgreSQL
   * ```typescript
   * import { PostgreSqlInboxDialect } from '@outboxy/dialect-postgres';
   * const inbox = new InboxyClient({ dialect: new PostgreSqlInboxDialect(), ... });
   * ```
   *
   * @example MySQL
   * ```typescript
   * import { MySqlInboxDialect } from '@outboxy/dialect-mysql';
   * const inbox = new InboxyClient({ dialect: new MySqlInboxDialect(), ... });
   * ```
   */
  dialect: InboxSqlDialect;

  /**
   * Default headers to include with each event (optional)
   *
   * Can be overridden per-event in receive() call.
   * Default: {}
   */
  defaultHeaders?: Record<string, unknown>;

  /**
   * Default metadata to include with each event (optional)
   *
   * Can be overridden per-event in receive() call.
   * Default: {}
   */
  defaultMetadata?: Record<string, unknown>;
}
