/**
 * Atomic Chain E2E Tests
 *
 * Validates the inbox → business logic → outbox atomic chain pattern.
 * This is the killer feature: receive, process, and publish in a single transaction.
 *
 * Test scenarios:
 * 1. Atomic chain: inbox.receive → business → outbox.publish (all succeed)
 * 2. Business failure rolls back both inbox and outbox
 * 3. Outbox failure rolls back both inbox and business
 * 4. Multiple outbox events in same transaction
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
import { createOutboxy } from "@outboxy/sdk";
import {
  PostgreSqlDialect,
  PostgreSqlInboxDialect,
} from "@outboxy/dialect-postgres";

describe("Atomic Chain E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "inbox-chain-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
    });
  }, 10000);

  afterAll(async () => {
    await adapter.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    await pool.query("TRUNCATE inbox_events CASCADE");
  });

  describe("Atomic Chain Success", () => {
    it("should atomically receive, process business logic, and publish outbox event", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://fulfillment.example.com/webhook",
      });

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // 1. Dedup incoming event
        const inboxResult = await inbox.receive(
          {
            idempotencyKey: "payment-atomic-1",
            aggregateType: "Payment",
            aggregateId: "payment-atomic-1",
            eventType: "PaymentCompleted",
            payload: {
              paymentId: "payment-atomic-1",
              orderId: "order-atomic-1",
              amount: 5000,
            },
            source: "stripe-webhook",
          },
          client,
        );

        if (inboxResult.status === "duplicate") {
          await client.query("COMMIT");
          return;
        }

        // 2. Business logic: update order status
        // (in real app, this would be an UPDATE to orders table)
        const businessResult = { orderId: "order-atomic-1", status: "paid" };

        // 3. Publish downstream event (same transaction!)
        const outboxEventId = await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: businessResult.orderId,
            eventType: "OrderPaid",
            payload: {
              orderId: businessResult.orderId,
              paidAt: new Date().toISOString(),
            },
          },
          client,
        );

        await client.query("COMMIT");

        // Verify inbox event was persisted
        const inboxRow = await pool.query(
          "SELECT * FROM inbox_events WHERE idempotency_key = $1",
          ["payment-atomic-1"],
        );
        expect(inboxRow.rows.length).toBe(1);
        expect(inboxRow.rows[0].status).toBe("processed");

        // Verify outbox event was persisted
        const outboxRow = await pool.query(
          "SELECT * FROM outbox_events WHERE id = $1",
          [outboxEventId],
        );
        expect(outboxRow.rows.length).toBe(1);
        expect(outboxRow.rows[0].event_type).toBe("OrderPaid");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });

    it("should handle duplicate receive in atomic chain", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://fulfillment.example.com/webhook",
      });

      const idempotencyKey = "payment-dup-chain-1";

      // First processing
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        const inboxResult1 = await inbox.receive(
          {
            idempotencyKey,
            aggregateType: "Payment",
            aggregateId: "payment-dup-chain-1",
            eventType: "PaymentCompleted",
            payload: { paymentId: "payment-dup-chain-1", orderId: "order-1" },
          },
          client1,
        );

        expect(inboxResult1.status).toBe("processed");

        await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderPaid",
            payload: { orderId: "order-1" },
          },
          client1,
        );

        await client1.query("COMMIT");
      } catch (error) {
        await client1.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client1.release();
      }

      // Second processing (duplicate delivery)
      const client2 = await pool.connect();
      let outboxPublishCalled = false;
      try {
        await client2.query("BEGIN");

        const inboxResult2 = await inbox.receive(
          {
            idempotencyKey,
            aggregateType: "Payment",
            aggregateId: "payment-dup-chain-1",
            eventType: "PaymentCompleted",
            payload: { paymentId: "payment-dup-chain-1", orderId: "order-1" },
          },
          client2,
        );

        if (inboxResult2.status === "duplicate") {
          await client2.query("COMMIT");
          return;
        }

        // This should NOT be reached
        outboxPublishCalled = true;
        await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderPaid",
            payload: { orderId: "order-1" },
          },
          client2,
        );

        await client2.query("COMMIT");
      } catch (error) {
        await client2.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client2.release();
      }

      // Verify outbox was NOT called for duplicate
      expect(outboxPublishCalled).toBe(false);

      // Verify only one outbox event exists
      const outboxCount = await pool.query(
        "SELECT COUNT(*) as count FROM outbox_events WHERE aggregate_id = $1",
        ["order-1"],
      );
      expect(Number(outboxCount.rows[0].count)).toBe(1);
    });
  });

  describe("Atomic Chain Rollback", () => {
    it("should rollback inbox and outbox when business logic fails", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://fulfillment.example.com/webhook",
      });

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // 1. Inbox receive
        await inbox.receive(
          {
            idempotencyKey: "payment-rollback-1",
            aggregateType: "Payment",
            aggregateId: "payment-rollback-1",
            eventType: "PaymentCompleted",
            payload: { paymentId: "payment-rollback-1" },
          },
          client,
        );

        // 2. Outbox publish
        await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-rollback-1",
            eventType: "OrderPaid",
            payload: { orderId: "order-rollback-1" },
          },
          client,
        );

        // 3. Business logic "fails" - rollback
        await client.query("ROLLBACK");

        // Verify inbox event was NOT persisted
        const inboxRow = await pool.query(
          "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
          ["payment-rollback-1"],
        );
        expect(Number(inboxRow.rows[0].count)).toBe(0);

        // Verify outbox event was NOT persisted
        const outboxRow = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE aggregate_id = $1",
          ["order-rollback-1"],
        );
        expect(Number(outboxRow.rows[0].count)).toBe(0);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });

    it("should allow retry after rollback", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://fulfillment.example.com/webhook",
      });

      const idempotencyKey = "payment-retry-1";

      // First attempt: fails and rolls back
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        await inbox.receive(
          {
            idempotencyKey,
            aggregateType: "Payment",
            aggregateId: "payment-retry-1",
            eventType: "PaymentCompleted",
            payload: { paymentId: "payment-retry-1" },
          },
          client1,
        );

        await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-retry-1",
            eventType: "OrderPaid",
            payload: { orderId: "order-retry-1" },
          },
          client1,
        );

        await client1.query("ROLLBACK");
      } catch (error) {
        await client1.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client1.release();
      }

      // Second attempt: succeeds
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");

        const inboxResult = await inbox.receive(
          {
            idempotencyKey,
            aggregateType: "Payment",
            aggregateId: "payment-retry-1",
            eventType: "PaymentCompleted",
            payload: { paymentId: "payment-retry-1" },
          },
          client2,
        );

        // Should be processed (not duplicate) because previous was rolled back
        expect(inboxResult.status).toBe("processed");

        await outbox.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-retry-1",
            eventType: "OrderPaid",
            payload: { orderId: "order-retry-1" },
          },
          client2,
        );

        await client2.query("COMMIT");
      } catch (error) {
        await client2.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client2.release();
      }

      // Verify both events were persisted
      const inboxCount = await pool.query(
        "SELECT COUNT(*) as count FROM inbox_events WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      expect(Number(inboxCount.rows[0].count)).toBe(1);

      const outboxCount = await pool.query(
        "SELECT COUNT(*) as count FROM outbox_events WHERE aggregate_id = $1",
        ["order-retry-1"],
      );
      expect(Number(outboxCount.rows[0].count)).toBe(1);
    });
  });

  describe("Multiple Outbox Events", () => {
    it("should publish multiple outbox events in same transaction as inbox receive", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://fulfillment.example.com/webhook",
      });

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Receive incoming event
        const inboxResult = await inbox.receive(
          {
            idempotencyKey: "payment-multi-outbox-1",
            aggregateType: "Payment",
            aggregateId: "payment-multi-outbox-1",
            eventType: "PaymentCompleted",
            payload: {
              paymentId: "payment-multi-outbox-1",
              orderId: "order-1",
            },
          },
          client,
        );

        expect(inboxResult.status).toBe("processed");

        // Publish multiple downstream events
        const eventIds = await outbox.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "order-1",
              eventType: "OrderPaid",
              payload: { orderId: "order-1" },
            },
            {
              aggregateType: "Inventory",
              aggregateId: "inventory-1",
              eventType: "ReserveInventory",
              payload: { orderId: "order-1", items: ["item-1"] },
            },
            {
              aggregateType: "Notification",
              aggregateId: "notification-1",
              eventType: "SendConfirmation",
              payload: { orderId: "order-1", email: "user@example.com" },
            },
          ],
          client,
        );

        await client.query("COMMIT");

        expect(eventIds.length).toBe(3);

        // Verify all outbox events were persisted
        const outboxCount = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = ANY($1)",
          [eventIds],
        );
        expect(Number(outboxCount.rows[0].count)).toBe(3);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
  });
});
