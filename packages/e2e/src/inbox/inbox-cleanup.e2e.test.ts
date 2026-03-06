/**
 * Inbox Cleanup E2E Tests
 *
 * Validates the cleanup functionality for processed inbox events
 * via the adapter's MaintenanceOperations (used by the worker's MaintenanceScheduler).
 *
 * Test scenarios:
 * 1. Basic cleanup of old processed events
 * 2. Cleanup preserves recent events
 * 3. Cleanup preserves failed events
 * 4. Cleanup allows reprocessing after retention window
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

describe("Inbox Cleanup E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let inboxClient: ReturnType<typeof createTestInboxClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "inbox-cleanup-e2e",
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

  describe("Basic Cleanup", () => {
    it("should delete old processed events", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await inboxClient.receive(
          {
            idempotencyKey: "cleanup-test-1",
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client,
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Manually set processed_at to 31 days ago
      await pool.query(`
        UPDATE inbox_events
        SET processed_at = NOW() - INTERVAL '31 days'
        WHERE idempotency_key = 'cleanup-test-1'
      `);

      // Run cleanup via adapter maintenance (used by worker's MaintenanceScheduler)
      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);

      expect(deletedCount).toBe(1);

      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        ["cleanup-test-1"],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    });

    it("should preserve recent processed events", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await inboxClient.receive(
          {
            idempotencyKey: "cleanup-recent-1",
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client,
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);

      expect(deletedCount).toBe(0);

      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        ["cleanup-recent-1"],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });

    it("should only delete processed events, not failed", async () => {
      const client = await pool.connect();
      let failedEventId: string;

      try {
        await client.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey: "cleanup-failed-1",
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client,
        );

        failedEventId = result.eventId!;
        await inboxClient.markFailed(failedEventId, "Test failure", client);

        await client.query("COMMIT");
      } finally {
        client.release();
      }

      // Manually set processed_at to 31 days ago
      await pool.query(`
        UPDATE inbox_events
        SET processed_at = NOW() - INTERVAL '31 days'
        WHERE idempotency_key = 'cleanup-failed-1'
      `);

      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);

      expect(deletedCount).toBe(0);

      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        ["cleanup-failed-1"],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });
  });

  describe("Multiple Events Cleanup", () => {
    it("should delete multiple old events in one call", async () => {
      const idempotencyKeys: string[] = [];

      for (let i = 0; i < 5; i++) {
        const key = `cleanup-multi-${i}`;
        idempotencyKeys.push(key);

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await inboxClient.receive(
            {
              idempotencyKey: key,
              aggregateType: "Order",
              aggregateId: `order-${i}`,
              eventType: "OrderCreated",
              payload: { orderId: `order-${i}` },
            },
            client,
          );
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      }

      // Make 3 events old (older than 30 days)
      await pool.query(`
        UPDATE inbox_events
        SET processed_at = NOW() - INTERVAL '31 days'
        WHERE idempotency_key IN ('cleanup-multi-0', 'cleanup-multi-1', 'cleanup-multi-2')
      `);

      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);

      expect(deletedCount).toBe(3);

      const remainingCount = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = ANY($1)",
        [idempotencyKeys],
      );
      expect(Number(remainingCount.rows[0].count)).toBe(2);

      const remaining = await pool.query(
        "SELECT idempotency_key FROM inbox_events WHERE idempotency_key = ANY($1) ORDER BY idempotency_key",
        [idempotencyKeys],
      );
      expect(remaining.rows.map((r) => r.idempotency_key)).toEqual([
        "cleanup-multi-3",
        "cleanup-multi-4",
      ]);
    });
  });

  describe("Reprocessing After Cleanup", () => {
    it("should allow reprocessing after cleanup (retention window passed)", async () => {
      const idempotencyKey = "cleanup-reprocess-1";

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

      // Duplicate should be detected
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");
        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", version: 1 },
          },
          client2,
        );
        expect(result.status).toBe("duplicate");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Make event old and cleanup
      await pool.query(`
        UPDATE inbox_events
        SET processed_at = NOW() - INTERVAL '31 days'
        WHERE idempotency_key = 'cleanup-reprocess-1'
      `);

      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);
      expect(deletedCount).toBe(1);

      // Now the same event can be processed again (at-least-once semantics)
      const client3 = await pool.connect();
      try {
        await client3.query("BEGIN");
        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", version: 2 },
          },
          client3,
        );
        expect(result.status).toBe("processed");
        await client3.query("COMMIT");
      } finally {
        client3.release();
      }
    });
  });

  describe("Edge Cases", () => {
    it("should return 0 when no events to cleanup", async () => {
      const deletedCount =
        await adapter.maintenance.cleanupProcessedInboxEvents!(30);
      expect(deletedCount).toBe(0);
    });
  });
});
