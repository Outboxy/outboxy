/**
 * Unified factory for creating Outboxy clients
 *
 * @packageDocumentation
 */

import type { SqlDialect, InboxSqlDialect } from "@outboxy/dialect-core";
import { OutboxyClient } from "./client.js";
import { InboxyClient } from "./inbox-client.js";
import type { InboxyConfig } from "./inbox-types.js";
import type { AdapterFn, OutboxyConfig } from "./types.js";

/**
 * Unified configuration for both outbox and inbox clients
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 */
export interface UnifiedOutboxyConfig<T> {
  /**
   * Adapter function that converts executor to QueryFn
   *
   * Shared by both outbox and inbox clients for transaction participation.
   */
  adapter: AdapterFn<T>;

  /**
   * SQL dialect for outbox operations
   */
  dialect: SqlDialect;

  /**
   * SQL dialect for inbox operations
   *
   * Import from @outboxy/dialect-postgres or @outboxy/dialect-mysql
   */
  inboxDialect: InboxSqlDialect;

  /**
   * Default destination URL for outbox events (optional)
   */
  defaultDestinationUrl?: string;

  /**
   * Default destination type for outbox events (optional)
   */
  defaultDestinationType?: "http" | "kafka" | "sqs" | "rabbitmq" | "pubsub";

  /**
   * Default max retries for outbox events (optional)
   */
  defaultMaxRetries?: number;

  /**
   * Default headers for both outbox and inbox events (optional)
   */
  defaultHeaders?: Record<string, unknown>;

  /**
   * Default metadata for both outbox and inbox events (optional)
   */
  defaultMetadata?: Record<string, unknown>;
}

/**
 * Result of createOutboxy() factory
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 */
export interface OutboxyClients<T> {
  /** Outbox client for publishing events */
  outbox: OutboxyClient<T>;

  /** Inbox client for receiving and deduplicating events */
  inbox: InboxyClient<T>;
}

/**
 * Create both outbox and inbox clients with shared configuration
 *
 * Eliminates duplicate adapter/dialect config when using both clients.
 * Both clients share the same adapter, allowing them to participate
 * in the same database transaction.
 *
 * @template T - The executor type (e.g., PoolClient, DrizzleTransaction)
 *
 * @param config - Unified configuration for both clients
 * @returns Object containing outbox and inbox clients
 *
 * @example PostgreSQL with atomic inbox→business→outbox chain
 * ```typescript
 * import { Pool, PoolClient } from 'pg';
 * import { createOutboxy } from '@outboxy/sdk';
 * import { PostgreSqlDialect, PostgreSqlInboxDialect } from '@outboxy/dialect-postgres';
 *
 * const pool = new Pool({ connectionString: DATABASE_URL });
 *
 * const { outbox, inbox } = createOutboxy<PoolClient>({
 *   dialect: new PostgreSqlDialect(),
 *   inboxDialect: new PostgreSqlInboxDialect(),
 *   adapter: (client) => async (sql, params) => {
 *     const result = await client.query(sql, params);
 *     return result.rows as { id: string }[];
 *   },
 *   defaultDestinationUrl: 'https://webhook.example.com',
 * });
 *
 * // Atomic chain: receive → process → publish
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *
 *   // 1. Dedup incoming event
 *   const result = await inbox.receive({
 *     idempotencyKey: event.id,
 *     aggregateType: 'Payment',
 *     aggregateId: event.paymentId,
 *     eventType: 'PaymentCompleted',
 *     payload: event.payload,
 *   }, client);
 *
 *   if (result.status === 'duplicate') {
 *     await client.query('COMMIT');
 *     return; // Already processed
 *   }
 *
 *   // 2. Business logic
 *   await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', orderId]);
 *
 *   // 3. Publish downstream event (same transaction!)
 *   await outbox.publish({
 *     aggregateType: 'Order',
 *     aggregateId: orderId,
 *     eventType: 'OrderPaid',
 *     payload: { orderId, paidAt: new Date().toISOString() },
 *   }, client);
 *
 *   await client.query('COMMIT');
 * } catch (error) {
 *   await client.query('ROLLBACK');
 *   throw error;
 * } finally {
 *   client.release();
 * }
 * ```
 */
export function createOutboxy<T>(
  config: UnifiedOutboxyConfig<T>,
): OutboxyClients<T> {
  const outboxConfig: OutboxyConfig<T> = {
    adapter: config.adapter,
    dialect: config.dialect,
    defaultDestinationUrl: config.defaultDestinationUrl,
    defaultDestinationType: config.defaultDestinationType,
    defaultMaxRetries: config.defaultMaxRetries,
    defaultHeaders: config.defaultHeaders,
    defaultMetadata: config.defaultMetadata,
  };

  const inboxConfig: InboxyConfig<T> = {
    adapter: config.adapter,
    dialect: config.inboxDialect,
    defaultHeaders: config.defaultHeaders,
    defaultMetadata: config.defaultMetadata,
  };

  return {
    outbox: new OutboxyClient(outboxConfig),
    inbox: new InboxyClient(inboxConfig),
  };
}
