/**
 * Idempotency Key Uniqueness E2E Tests
 *
 * Validates OUTBOX-4: Idempotency key uniqueness guarantees
 *
 * Test scenarios:
 * 1. Duplicate idempotency key returns same event ID for pending events
 * 2. Same idempotency key allowed after first event succeeds
 * 3. Multiple events with unique idempotency keys
 * 4. Idempotency key within batch validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  type Pool,
  type PoolClient,
} from "@outboxy/testing-utils";
import {
  createPostgresAdapter,
  type PostgresAdapter,
} from "@outboxy/db-adapter-postgres";
import { OutboxyClient } from "@outboxy/sdk";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

describe("Idempotency Key Uniqueness E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let outboxyClient: OutboxyClient<PoolClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "idempotency-uniqueness-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
    });

    // Create SDK client with pg adapter
    outboxyClient = new OutboxyClient({
      dialect: new PostgreSqlDialect(),
      adapter: (client) => async (sql, params) => {
        const result = await client.query(sql, params);
        return result.rows as { id: string }[];
      },
      defaultDestinationUrl: "https://webhook.example.com",
    });
  }, 10000);

  afterAll(async () => {
    await adapter.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
  });

  describe("Duplicate Key Rejection", () => {
    it("should return same event ID for duplicate idempotency key on pending events", async () => {
      const idempotencyKey = "order-created-123";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // First publish should succeed
        const firstEventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: { orderId: "order-123", total: 100 },
            idempotencyKey,
          },
          client,
        );

        expect(firstEventId).toBeDefined();

        // Verify first event exists within transaction
        const inTxResult = await client.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(Number(inTxResult.rows[0].count)).toBe(1);

        // Second publish with same key succeeds but returns same ID (ON CONFLICT DO UPDATE)
        const secondEventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123-dup",
            eventType: "OrderCreated",
            payload: { orderId: "order-123-dup", total: 200 },
            idempotencyKey,
          },
          client,
        );

        // The ON CONFLICT clause with DO UPDATE returns the original row
        // So secondEventId will be the same as firstEventId
        expect(secondEventId).toBe(firstEventId);

        // Verify only one event exists within transaction
        const finalResult = await client.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(Number(finalResult.rows[0].count)).toBe(1);

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    it("should allow same idempotency key after first event succeeds", async () => {
      const idempotencyKey = "order-created-456";
      const client = await pool.connect();

      try {
        // First transaction: create and succeed event
        await client.query("BEGIN");

        const firstEventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: { orderId: "order-456", total: 100 },
            idempotencyKey,
          },
          client,
        );

        await client.query("COMMIT");

        // Mark first event as succeeded
        await pool.query(
          "UPDATE outbox_events SET status = 'succeeded' WHERE id = $1",
          [firstEventId],
        );

        // Second transaction: reuse idempotency key
        const client2 = await pool.connect();

        try {
          await client2.query("BEGIN");

          const secondEventId = await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-456-v2",
              eventType: "OrderCreated",
              payload: { orderId: "order-456-v2", total: 200 },
              idempotencyKey,
            },
            client2,
          );

          await client2.query("COMMIT");

          // Verify two events exist with same idempotency key
          const result = await pool.query(
            "SELECT id, aggregate_id, payload FROM outbox_events WHERE idempotency_key = $1 ORDER BY created_at",
            [idempotencyKey],
          );

          expect(result.rows.length).toBe(2);
          expect(result.rows[0].id).toBe(firstEventId);
          expect(result.rows[0].aggregate_id).toBe("order-456");
          expect(result.rows[1].id).toBe(secondEventId);
          expect(result.rows[1].aggregate_id).toBe("order-456-v2");
        } finally {
          client2.release();
        }
      } finally {
        client.release();
      }
    });

    it("should allow same idempotency key after first event fails", async () => {
      const idempotencyKey = "order-created-789";
      const client = await pool.connect();

      try {
        // First transaction: create event but leave it as failed
        await client.query("BEGIN");

        const firstEventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-789",
            eventType: "OrderCreated",
            payload: { orderId: "order-789", total: 100 },
            idempotencyKey,
          },
          client,
        );

        await client.query("COMMIT");

        // Mark first event as failed
        await pool.query(
          "UPDATE outbox_events SET status = 'failed' WHERE id = $1",
          [firstEventId],
        );

        // Second transaction: should return the same event (ON CONFLICT with status != succeeded)
        const client2 = await pool.connect();

        try {
          await client2.query("BEGIN");

          const secondEventId = await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-789-dup",
              eventType: "OrderCreated",
              payload: { orderId: "order-789-dup", total: 200 },
              idempotencyKey,
            },
            client2,
          );

          // Since status is 'failed' (not 'succeeded'), ON CONFLICT still returns the original event
          expect(secondEventId).toBe(firstEventId);

          await client2.query("ROLLBACK");

          // Verify only one event exists
          const result = await pool.query(
            "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key = $1",
            [idempotencyKey],
          );
          expect(Number(result.rows[0].count)).toBe(1);
        } finally {
          client2.release();
        }
      } finally {
        client.release();
      }
    });
  });

  describe("Unique Keys", () => {
    it("should allow multiple events with unique idempotency keys", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const eventIds = await outboxyClient.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "order-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-1", total: 100 },
              idempotencyKey: "unique-key-1",
            },
            {
              aggregateType: "Order",
              aggregateId: "order-2",
              eventType: "OrderCreated",
              payload: { orderId: "order-2", total: 200 },
              idempotencyKey: "unique-key-2",
            },
            {
              aggregateType: "Order",
              aggregateId: "order-3",
              eventType: "OrderCreated",
              payload: { orderId: "order-3", total: 300 },
              idempotencyKey: "unique-key-3",
            },
          ],
          client,
        );

        await client.query("COMMIT");

        // Verify all events were created
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key IN ($1, $2, $3)",
          ["unique-key-1", "unique-key-2", "unique-key-3"],
        );
        expect(Number(result.rows[0].count)).toBe(3);

        // Verify each event has unique key
        const keysResult = await pool.query(
          "SELECT idempotency_key FROM outbox_events WHERE id = ANY($1) ORDER BY idempotency_key",
          [eventIds],
        );
        expect(keysResult.rows.map((r) => r.idempotency_key)).toEqual([
          "unique-key-1",
          "unique-key-2",
          "unique-key-3",
        ]);
      } finally {
        client.release();
      }
    });

    it("should allow events without idempotency keys", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-no-key-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-no-key-1", total: 100 },
          },
          client,
        );

        await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-no-key-2",
            eventType: "OrderCreated",
            payload: { orderId: "order-no-key-2", total: 200 },
          },
          client,
        );

        await client.query("COMMIT");

        // Verify both events were created with NULL idempotency keys
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key IS NULL",
        );
        expect(Number(result.rows[0].count)).toBe(2);
      } finally {
        client.release();
      }
    });
  });

  describe("Batch Validation", () => {
    it("should reject batch with duplicate idempotency keys", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let error: Error | null = null;
        try {
          await outboxyClient.publishBatch(
            [
              {
                aggregateType: "Order",
                aggregateId: "order-batch-1",
                eventType: "OrderCreated",
                payload: { orderId: "order-batch-1", total: 100 },
                idempotencyKey: "batch-dup-key",
              },
              {
                aggregateType: "Order",
                aggregateId: "order-batch-2",
                eventType: "OrderCreated",
                payload: { orderId: "order-batch-2", total: 200 },
                idempotencyKey: "batch-dup-key",
              },
            ],
            client,
          );
        } catch (e) {
          error = e as Error;
        }

        await client.query("ROLLBACK");

        // Verify validation error was thrown
        expect(error).toBeDefined();
        expect(error?.message).toContain(
          "Duplicate idempotency keys within batch",
        );
      } finally {
        client.release();
      }
    });

    it("should allow batch with unique idempotency keys", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const eventIds = await outboxyClient.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "order-batch-unique-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-batch-unique-1", total: 100 },
              idempotencyKey: "batch-unique-1",
            },
            {
              aggregateType: "Order",
              aggregateId: "order-batch-unique-2",
              eventType: "OrderCreated",
              payload: { orderId: "order-batch-unique-2", total: 200 },
              idempotencyKey: "batch-unique-2",
            },
            {
              aggregateType: "Order",
              aggregateId: "order-batch-unique-3",
              eventType: "OrderCreated",
              payload: { orderId: "order-batch-unique-3", total: 300 },
              idempotencyKey: "batch-unique-3",
            },
          ],
          client,
        );

        await client.query("COMMIT");

        // Verify all events were created
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = ANY($1)",
          [eventIds],
        );
        expect(Number(result.rows[0].count)).toBe(3);
      } finally {
        client.release();
      }
    });
  });

  describe("Idempotency Key Format Validation", () => {
    it("should reject empty idempotency key", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let error: Error | null = null;
        try {
          await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-empty-key",
              eventType: "OrderCreated",
              payload: { orderId: "order-empty-key", total: 100 },
              idempotencyKey: "",
            },
            client,
          );
        } catch (e) {
          error = e as Error;
        }

        await client.query("ROLLBACK");

        // Verify validation error was thrown
        expect(error).toBeDefined();
        expect(error?.message).toContain("Idempotency key cannot be empty");
      } finally {
        client.release();
      }
    });

    it("should reject idempotency key exceeding 255 characters", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let error: Error | null = null;
        try {
          await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-long-key",
              eventType: "OrderCreated",
              payload: { orderId: "order-long-key", total: 100 },
              idempotencyKey: "a".repeat(256),
            },
            client,
          );
        } catch (e) {
          error = e as Error;
        }

        await client.query("ROLLBACK");

        // Verify validation error was thrown
        expect(error).toBeDefined();
        expect(error?.message).toContain(
          "Idempotency key cannot exceed 255 characters",
        );
      } finally {
        client.release();
      }
    });

    it("should reject idempotency key with invalid characters", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let error: Error | null = null;
        try {
          await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-invalid-key",
              eventType: "OrderCreated",
              payload: { orderId: "order-invalid-key", total: 100 },
              idempotencyKey: "invalid-key-with-spaces!",
            },
            client,
          );
        } catch (e) {
          error = e as Error;
        }

        await client.query("ROLLBACK");

        // Verify validation error was thrown
        expect(error).toBeDefined();
        expect(error?.message).toContain(
          "Idempotency key must contain only alphanumeric characters",
        );
      } finally {
        client.release();
      }
    });

    it("should accept valid idempotency key formats", async () => {
      const validKeys = [
        "order-123",
        "order_created",
        "ORDER-ABC-123",
        "123456789",
        "order_123_uuid-456",
      ];

      for (const key of validKeys) {
        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          const eventId = await outboxyClient.publish(
            {
              aggregateType: "Order",
              aggregateId: `order-${key}`,
              eventType: "OrderCreated",
              payload: { orderId: `order-${key}`, total: 100 },
              idempotencyKey: key,
            },
            client,
          );

          await client.query("ROLLBACK");

          // Verify event was created successfully
          expect(eventId).toBeDefined();
        } finally {
          client.release();
        }
      }
    });
  });
});
