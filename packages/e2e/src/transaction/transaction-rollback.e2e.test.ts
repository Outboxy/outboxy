/**
 * Transaction Rollback E2E Tests
 *
 * Validates OUTBOX-3: Transaction rollback behavior
 *
 * Test scenarios:
 * 1. Event NOT in DB after transaction rollback
 * 2. Event IS in DB after transaction commit
 * 3. Multiple events rollback together
 * 4. Partial rollback (some events committed, some rolled back)
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

describe("Transaction Rollback E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let outboxyClient: OutboxyClient<PoolClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "transaction-rollback-e2e",
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

  describe("Single Event Transaction", () => {
    it("should NOT persist event after transaction rollback", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish event within transaction
        const eventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-rollback-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-rollback-1", total: 100 },
          },
          client,
        );

        // Verify event is visible within transaction
        const inTxResult = await client.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = $1",
          [eventId],
        );
        expect(Number(inTxResult.rows[0].count)).toBe(1);

        // Rollback transaction
        await client.query("ROLLBACK");

        // Verify event is NOT visible after rollback
        const afterRollbackResult = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = $1",
          [eventId],
        );
        expect(Number(afterRollbackResult.rows[0].count)).toBe(0);

        // Verify no events exist in table
        const allEventsResult = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events",
        );
        expect(Number(allEventsResult.rows[0].count)).toBe(0);
      } finally {
        client.release();
      }
    });

    it("should persist event after transaction commit", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish event within transaction
        const eventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-commit-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-commit-1", total: 200 },
          },
          client,
        );

        // Commit transaction
        await client.query("COMMIT");

        // Verify event IS visible after commit
        const result = await pool.query(
          "SELECT * FROM outbox_events WHERE id = $1",
          [eventId],
        );

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].aggregate_type).toBe("Order");
        expect(result.rows[0].aggregate_id).toBe("order-commit-1");
        expect(result.rows[0].event_type).toBe("OrderCreated");
        expect(result.rows[0].status).toBe("pending");
      } finally {
        client.release();
      }
    });
  });

  describe("Multiple Events Transaction", () => {
    it("should rollback all events together", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish multiple events within transaction
        const eventIds = await outboxyClient.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "order-multi-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-multi-1", total: 100 },
            },
            {
              aggregateType: "Order",
              aggregateId: "order-multi-2",
              eventType: "OrderCreated",
              payload: { orderId: "order-multi-2", total: 200 },
            },
            {
              aggregateType: "Order",
              aggregateId: "order-multi-3",
              eventType: "OrderCreated",
              payload: { orderId: "order-multi-3", total: 300 },
            },
          ],
          client,
        );

        // Verify all events are visible within transaction
        const inTxResult = await client.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = ANY($1)",
          [eventIds],
        );
        expect(Number(inTxResult.rows[0].count)).toBe(3);

        // Rollback transaction
        await client.query("ROLLBACK");

        // Verify NO events are visible after rollback
        for (const eventId of eventIds) {
          const result = await pool.query(
            "SELECT COUNT(*) as count FROM outbox_events WHERE id = $1",
            [eventId],
          );
          expect(Number(result.rows[0].count)).toBe(0);
        }

        // Verify table is empty
        const allEventsResult = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events",
        );
        expect(Number(allEventsResult.rows[0].count)).toBe(0);
      } finally {
        client.release();
      }
    });

    it("should commit all events together", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish multiple events within transaction
        const eventIds = await outboxyClient.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "order-commit-multi-1",
              eventType: "OrderCreated",
              payload: { orderId: "order-commit-multi-1", total: 100 },
            },
            {
              aggregateType: "Order",
              aggregateId: "order-commit-multi-2",
              eventType: "OrderCreated",
              payload: { orderId: "order-commit-multi-2", total: 200 },
            },
          ],
          client,
        );

        // Commit transaction
        await client.query("COMMIT");

        // Verify all events are visible after commit
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = ANY($1)",
          [eventIds],
        );
        expect(Number(result.rows[0].count)).toBe(2);

        // Verify each event has correct data
        for (const eventId of eventIds) {
          const eventResult = await pool.query(
            "SELECT * FROM outbox_events WHERE id = $1",
            [eventId],
          );
          expect(eventResult.rows.length).toBe(1);
          expect(eventResult.rows[0].status).toBe("pending");
        }
      } finally {
        client.release();
      }
    });
  });

  describe("Mixed Operations", () => {
    it("should rollback event when business logic fails", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish event
        const eventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-fail-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-fail-1", total: 100 },
          },
          client,
        );

        // Simulate business logic failure
        await client.query("ROLLBACK");

        // Verify event was rolled back
        const eventResult = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = $1",
          [eventId],
        );
        expect(Number(eventResult.rows[0].count)).toBe(0);
      } finally {
        client.release();
      }
    });

    it("should commit event when business logic succeeds", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Publish event
        const eventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-success-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-success-1", total: 200 },
          },
          client,
        );

        // Commit transaction
        await client.query("COMMIT");

        // Verify event was committed
        const eventResult = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE id = $1",
          [eventId],
        );
        expect(Number(eventResult.rows[0].count)).toBe(1);
      } finally {
        client.release();
      }
    });
  });

  describe("Idempotency Key with Rollback", () => {
    it("should allow reuse of idempotency key after rollback", async () => {
      const idempotencyKey = "order-idempotent-rollback";

      const client1 = await pool.connect();

      try {
        // First attempt: publish with rollback
        await client1.query("BEGIN");

        await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-1",
            eventType: "OrderCreated",
            payload: { orderId: "order-1", total: 100 },
            idempotencyKey,
          },
          client1,
        );

        await client1.query("ROLLBACK");
      } finally {
        client1.release();
      }

      // Second attempt: should succeed (previous event was rolled back)
      const client2 = await pool.connect();

      try {
        await client2.query("BEGIN");

        const eventId = await outboxyClient.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-2",
            eventType: "OrderCreated",
            payload: { orderId: "order-2", total: 200 },
            idempotencyKey,
          },
          client2,
        );

        await client2.query("COMMIT");

        // Verify only one event exists with the idempotency key
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(Number(result.rows[0].count)).toBe(1);

        // Verify the event has the second attempt's data
        const eventResult = await pool.query(
          "SELECT * FROM outbox_events WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        expect(eventResult.rows[0].aggregate_id).toBe("order-2");
        expect(eventResult.rows[0].id).toBe(eventId);
      } finally {
        client2.release();
      }
    });
  });
});
