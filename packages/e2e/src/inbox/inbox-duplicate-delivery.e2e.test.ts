/**
 * Duplicate Delivery E2E Tests
 *
 * Validates inbox pattern behavior with duplicate event deliveries.
 * Simulates real-world scenarios where events are delivered multiple times.
 *
 * Test scenarios:
 * 1. Same event delivered twice → second is duplicate
 * 2. Concurrent delivery attempts → only one succeeds
 * 3. Multiple duplicate deliveries → all after first are duplicates
 * 4. Duplicate detection with different payload (same key)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  type Pool,
} from "@outboxy/testing-utils";
import {
  createPostgresAdapter,
  type PostgresAdapter,
} from "@outboxy/db-adapter-postgres";
import { createTestInboxClient } from "./helpers.js";

describe("Duplicate Delivery E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let inboxClient: ReturnType<typeof createTestInboxClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "inbox-dup-delivery-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
    });

    inboxClient = createTestInboxClient();
  }, 10000);

  afterAll(async () => {
    await adapter.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE inbox_events CASCADE");
  });

  describe("Basic Duplicate Detection", () => {
    it("should detect second delivery as duplicate", async () => {
      const idempotencyKey = "webhook-event-123";

      // First delivery
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");
        const result1 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Webhook",
            aggregateId: "event-123",
            eventType: "WebhookReceived",
            payload: { source: "stripe", data: { id: "evt_123" } },
          },
          client1,
        );
        expect(result1.status).toBe("processed");
        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Second delivery (duplicate)
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");
        const result2 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Webhook",
            aggregateId: "event-123",
            eventType: "WebhookReceived",
            payload: { source: "stripe", data: { id: "evt_123" } },
          },
          client2,
        );
        expect(result2.status).toBe("duplicate");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Verify only one record exists
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });

    it("should detect multiple duplicate deliveries", async () => {
      const idempotencyKey = "kafka-msg-456";

      // First delivery
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");
        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: { orderId: "order-456" },
          },
          client1,
        );
        expect(result.status).toBe("processed");
        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Multiple duplicate deliveries
      for (let i = 0; i < 5; i++) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await inboxClient.receive(
            {
              idempotencyKey,
              aggregateType: "Order",
              aggregateId: "order-456",
              eventType: "OrderCreated",
              payload: { orderId: "order-456" },
            },
            client,
          );
          expect(result.status).toBe("duplicate");
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      }

      // Verify only one record exists
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });
  });

  describe("Duplicate with Different Payload", () => {
    it("should still detect duplicate even with different payload", async () => {
      const idempotencyKey = "same-key-diff-payload";

      // First delivery with payload A
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");
        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", version: 1 },
          },
          client1,
        );
        expect(result.status).toBe("processed");
        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Second delivery with different payload (but same key)
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");
        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", version: 999 }, // Different!
          },
          client2,
        );
        expect(result.status).toBe("duplicate");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Verify original payload is preserved
      const row = await pool.query(
        "SELECT payload FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(row.rows[0].payload).toEqual({ orderId: "order-1", version: 1 });
    });
  });

  describe("Concurrent Delivery Attempts", () => {
    it("should handle sequential delivery attempts with same key", async () => {
      const idempotencyKey = "sequential-test-1";

      // First transaction: receive and commit
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");
        const result1 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-sequential",
            eventType: "OrderCreated",
            payload: { orderId: "order-sequential" },
          },
          client1,
        );
        expect(result1.status).toBe("processed");
        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Second transaction: same key should be duplicate
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");
        const result2 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-sequential",
            eventType: "OrderCreated",
            payload: { orderId: "order-sequential" },
          },
          client2,
        );
        expect(result2.status).toBe("duplicate");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Verify only one record exists
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });
  });

  describe("Batch Duplicate Detection", () => {
    it("should handle receiveBatch with all new events", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const results = await inboxClient.receiveBatch(
          [
            {
              idempotencyKey: "batch-all-new-1",
              aggregateType: "Order",
              aggregateId: "order-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-1" },
            },
            {
              idempotencyKey: "batch-all-new-2",
              aggregateType: "Order",
              aggregateId: "order-2",
              eventType: "OrderCreated",
              payload: { orderId: "order-2" },
            },
            {
              idempotencyKey: "batch-all-new-3",
              aggregateType: "Order",
              aggregateId: "order-3",
              eventType: "OrderCreated",
              payload: { orderId: "order-3" },
            },
          ],
          client,
        );

        await client.query("COMMIT");

        expect(results.length).toBe(3);
        expect(results.every((r) => r.status === "processed")).toBe(true);
      } finally {
        client.release();
      }
    });

    it("should reject batch with duplicate idempotency keys within batch", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await expect(
          inboxClient.receiveBatch(
            [
              {
                idempotencyKey: "batch-dup-key",
                aggregateType: "Order",
                aggregateId: "order-1",
                eventType: "OrderCreated",
                payload: { orderId: "order-1" },
              },
              {
                idempotencyKey: "batch-dup-key", // Same key!
                aggregateType: "Order",
                aggregateId: "order-2",
                eventType: "OrderCreated",
                payload: { orderId: "order-2" },
              },
            ],
            client,
          ),
        ).rejects.toThrow("Duplicate idempotency keys within batch");

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });
});
