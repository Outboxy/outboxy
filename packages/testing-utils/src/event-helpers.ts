/**
 * Event insertion helpers for e2e tests
 *
 * Provides efficient batch insertion of test events.
 *
 * @packageDocumentation
 */

import type { Pool } from "pg";

export interface InsertTestEventsOptions {
  /** Base aggregate type (default: "Order") */
  aggregateType?: string;
  /** Event type (default: "OrderCreated") */
  eventType?: string;
  /** Destination URL for events */
  destinationUrl: string;
  /** Prefix for aggregate IDs (default: "order") */
  aggregateIdPrefix?: string;
  /** Batch size for INSERT statements (default: 100) */
  insertBatchSize?: number;
}

/**
 * Insert test events efficiently using batch INSERTs.
 *
 * Uses parameterized batch INSERTs (100 events per query by default)
 * which is significantly faster than individual INSERTs.
 *
 * @example
 * ```typescript
 * // Insert 100 events
 * await insertTestEvents(pool, 100, {
 *   destinationUrl: mockServer.url,
 * });
 *
 * // Insert with custom settings
 * await insertTestEvents(pool, 50, {
 *   aggregateType: "User",
 *   eventType: "UserCreated",
 *   destinationUrl: "kafka://user-events",
 *   aggregateIdPrefix: "user",
 * });
 * ```
 */
export async function insertTestEvents(
  pool: Pool,
  count: number,
  options: InsertTestEventsOptions,
): Promise<void> {
  const {
    aggregateType = "Order",
    eventType = "OrderCreated",
    destinationUrl,
    aggregateIdPrefix = "order",
    insertBatchSize = 100,
  } = options;

  const batches = Math.ceil(count / insertBatchSize);

  for (let batch = 0; batch < batches; batch++) {
    const currentBatchSize = Math.min(
      insertBatchSize,
      count - batch * insertBatchSize,
    );
    const values: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < currentBatchSize; i++) {
      const eventNum = batch * insertBatchSize + i;
      const offset = params.length;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
      );
      params.push(
        aggregateType,
        `${aggregateIdPrefix}-${eventNum}`,
        eventType,
        JSON.stringify({ orderNumber: eventNum }),
        destinationUrl,
      );
    }

    await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ${values.join(", ")}`,
      params,
    );
  }
}
