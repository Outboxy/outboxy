/**
 * Transaction Rollback E2E Tests for Inbox Pattern
 *
 * Validates that inbox events are correctly rolled back when transactions fail.
 * This ensures the inbox record disappears on rollback, allowing retry.
 *
 * Test scenarios:
 * 1. Rollback after receive → event can be received again
 * 2. Explicit ROLLBACK command
 * 3. Transaction timeout/implicit rollback
 * 4. Exception during transaction
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

describe("Inbox Transaction Rollback E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let inboxClient: ReturnType<typeof createTestInboxClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "inbox-rollback-e2e",
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

  describe("Explicit Rollback", () => {
    it("should NOT persist event after transaction rollback", async () => {
      const idempotencyKey = "rollback-test-1";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", total: 100 },
          },
          client,
        );

        expect(result.status).toBe("processed");

        // Verify event is visible within transaction
        const inTxResult = await client.query(
          "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(Number(inTxResult.rows[0].count)).toBe(1);

        // Rollback transaction
        await client.query("ROLLBACK");

        // Verify event is NOT visible after rollback
        const afterRollbackResult = await pool.query(
          "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(Number(afterRollbackResult.rows[0].count)).toBe(0);
      } finally {
        client.release();
      }
    });

    it("should persist event after transaction commit", async () => {
      const idempotencyKey = "commit-test-1";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", total: 100 },
          },
          client,
        );

        expect(result.status).toBe("processed");

        // Commit transaction
        await client.query("COMMIT");

        // Verify event IS visible after commit
        const afterCommitResult = await pool.query(
          "SELECT * FROM inbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );

        expect(afterCommitResult.rows.length).toBe(1);
        expect(afterCommitResult.rows[0].aggregate_type).toBe("Order");
        expect(afterCommitResult.rows[0].aggregate_id).toBe("order-1");
        expect(afterCommitResult.rows[0].event_type).toBe("OrderCreated");
        expect(afterCommitResult.rows[0].status).toBe("processed");
      } finally {
        client.release();
      }
    });
  });

  describe("Retry After Rollback", () => {
    it("should allow retry after rollback", async () => {
      const idempotencyKey = "retry-after-rollback-1";

      // First attempt: receive then rollback
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        const result1 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", total: 100 },
          },
          client1,
        );

        expect(result1.status).toBe("processed");

        await client1.query("ROLLBACK");
      } finally {
        client1.release();
      }

      // Second attempt: should succeed (previous was rolled back)
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");

        const result2 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", total: 100 },
          },
          client2,
        );

        expect(result2.status).toBe("processed");

        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Verify only one event exists
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });

    it("should allow multiple retries after repeated rollbacks", async () => {
      const idempotencyKey = "multi-retry-1";

      // Multiple failed attempts
      for (let i = 0; i < 3; i++) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const result = await inboxClient.receive(
            {
              idempotencyKey,
              aggregateType: "Order",
              aggregateId: "order-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-1", attempt: i },
            },
            client,
          );

          expect(result.status).toBe("processed");
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }

      // Final successful attempt
      const clientFinal = await pool.connect();
      try {
        await clientFinal.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", attempt: 3 },
          },
          clientFinal,
        );

        expect(result.status).toBe("processed");
        await clientFinal.query("COMMIT");
      } finally {
        clientFinal.release();
      }

      // Verify only one event exists
      const row = await pool.query(
        "SELECT * FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(row.rows.length).toBe(1);
      expect(row.rows[0].payload).toEqual({ orderId: "order-1", attempt: 3 });
    });
  });

  describe("Exception During Transaction", () => {
    it("should rollback when exception is thrown", async () => {
      const idempotencyKey = "exception-test-1";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client,
        );

        // Simulate business logic failure
        throw new Error("Business logic failed!");
      } catch (error) {
        await client.query("ROLLBACK");
        expect((error as Error).message).toBe("Business logic failed!");
      } finally {
        client.release();
      }

      // Verify event was rolled back
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    });

    it("should allow retry after exception rollback", async () => {
      const idempotencyKey = "exception-retry-1";

      // First attempt: fails with exception
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client1,
        );

        throw new Error("Simulated failure");
      } catch {
        await client1.query("ROLLBACK");
      } finally {
        client1.release();
      }

      // Second attempt: succeeds
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client2,
        );

        expect(result.status).toBe("processed");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }

      // Verify event was persisted on second attempt
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(1);
    });
  });

  describe("MarkFailed", () => {
    it("should mark event as failed instead of rollback", async () => {
      const idempotencyKey = "mark-failed-test-1";
      let eventId: string;

      // Receive event
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client1,
        );

        eventId = result.eventId!;

        // Business logic fails, but we want to record the failure
        await inboxClient.markFailed(
          eventId,
          "Payment verification failed",
          client1,
        );

        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Verify event exists with failed status
      const row = await pool.query(
        "SELECT * FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );

      expect(row.rows.length).toBe(1);
      expect(row.rows[0].status).toBe("failed");
      expect(row.rows[0].error).toBe("Payment verification failed");

      // Verify duplicate detection still works
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client2,
        );

        expect(result.status).toBe("duplicate");

        await client2.query("COMMIT");
      } finally {
        client2.release();
      }
    });
  });

  describe("Connection Release", () => {
    it("should properly cleanup on explicit ROLLBACK before release", async () => {
      const idempotencyKey = "release-test-1";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1" },
          },
          client,
        );

        // Explicit rollback before release
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      // Verify event was NOT persisted
      const count = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    });
  });
});
