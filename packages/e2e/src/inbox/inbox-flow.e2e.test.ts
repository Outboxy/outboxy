/**
 * Inbox Flow E2E Tests
 *
 * Validates the basic inbox pattern: receive → dedup → process
 *
 * Test scenarios:
 * 1. First receive returns 'processed' status
 * 2. Duplicate receive returns 'duplicate' status
 * 3. Different idempotency keys are treated as different events
 * 4. Event is persisted with correct data
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
import {
  PostgreSqlDialect,
  PostgreSqlInboxDialect,
} from "@outboxy/dialect-postgres";
import { createTestInboxClient } from "./helpers.js";
import { createOutboxy } from "@outboxy/sdk";

describe("Inbox Flow E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let inboxClient: ReturnType<typeof createTestInboxClient>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "inbox-flow-e2e",
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

  describe("Basic Receive", () => {
    it("should return 'processed' status for first receive", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey: "order-123-created",
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: { orderId: "order-123", total: 100 },
          },
          client,
        );

        expect(result.status).toBe("processed");
        expect(result.eventId).toBeDefined();
        expect(result.eventId).not.toBe("unknown");

        await client.query("COMMIT");
      } finally {
        client.release();
      }
    });

    it("should return 'duplicate' status for duplicate receive", async () => {
      const idempotencyKey = "order-456-created";

      // First receive
      const client1 = await pool.connect();
      try {
        await client1.query("BEGIN");

        const result1 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: { orderId: "order-456", total: 200 },
          },
          client1,
        );

        expect(result1.status).toBe("processed");
        await client1.query("COMMIT");
      } finally {
        client1.release();
      }

      // Second receive (duplicate)
      const client2 = await pool.connect();
      try {
        await client2.query("BEGIN");

        const result2 = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: { orderId: "order-456", total: 200 },
          },
          client2,
        );

        expect(result2.status).toBe("duplicate");
        await client2.query("COMMIT");
      } finally {
        client2.release();
      }
    });

    it("should treat different idempotency keys as different events", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result1 = await inboxClient.receive(
          {
            idempotencyKey: "order-789-created",
            aggregateType: "Order",
            aggregateId: "order-789",
            eventType: "OrderCreated",
            payload: { orderId: "order-789", total: 100 },
          },
          client,
        );

        const result2 = await inboxClient.receive(
          {
            idempotencyKey: "order-789-updated",
            aggregateType: "Order",
            aggregateId: "order-789",
            eventType: "OrderUpdated",
            payload: { orderId: "order-789", total: 150 },
          },
          client,
        );

        expect(result1.status).toBe("processed");
        expect(result2.status).toBe("processed");
        expect(result1.eventId).not.toBe(result2.eventId);

        await client.query("COMMIT");
      } finally {
        client.release();
      }
    });
  });

  describe("Event Data Persistence", () => {
    it("should persist event with correct data", async () => {
      const idempotencyKey = "payment-123-completed";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const result = await inboxClient.receive(
          {
            idempotencyKey,
            aggregateType: "Payment",
            aggregateId: "payment-123",
            eventType: "PaymentCompleted",
            payload: {
              paymentId: "payment-123",
              amount: 5000,
              currency: "USD",
            },
            source: "stripe-webhook",
            eventVersion: 2,
            headers: { "x-request-id": "req-123" },
            metadata: { correlationId: "corr-456" },
          },
          client,
        );

        await client.query("COMMIT");

        // Verify persisted data
        const dbResult = await pool.query(
          "SELECT * FROM inbox_events WHERE id = $1",
          [result.eventId],
        );

        expect(dbResult.rows.length).toBe(1);
        const row = dbResult.rows[0];

        expect(row.idempotency_key).toBe(idempotencyKey);
        expect(row.aggregate_type).toBe("Payment");
        expect(row.aggregate_id).toBe("payment-123");
        expect(row.event_type).toBe("PaymentCompleted");
        expect(row.event_version).toBe(2);
        expect(row.source).toBe("stripe-webhook");
        expect(row.status).toBe("processed");
        expect(row.payload).toEqual({
          paymentId: "payment-123",
          amount: 5000,
          currency: "USD",
        });
        expect(row.headers).toEqual({ "x-request-id": "req-123" });
        expect(row.metadata).toEqual({ correlationId: "corr-456" });
        expect(row.received_at).toBeDefined();
        expect(row.processed_at).toBeDefined();
      } finally {
        client.release();
      }
    });
  });

  describe("Validation", () => {
    it("should require idempotencyKey", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await expect(
          inboxClient.receive(
            {
              idempotencyKey: "",
              aggregateType: "Order",
              aggregateId: "order-123",
              eventType: "OrderCreated",
              payload: { orderId: "order-123" },
            },
            client,
          ),
        ).rejects.toThrow("idempotencyKey is required");

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    it("should validate eventVersion is positive integer", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await expect(
          inboxClient.receive(
            {
              idempotencyKey: "order-invalid-version",
              aggregateType: "Order",
              aggregateId: "order-123",
              eventType: "OrderCreated",
              payload: { orderId: "order-123" },
              eventVersion: -1,
            },
            client,
          ),
        ).rejects.toThrow("eventVersion must be a positive integer");

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });
  });

  describe("createOutboxy Factory", () => {
    it("should create both outbox and inbox clients with shared adapter", async () => {
      const { outbox, inbox } = createOutboxy<PoolClient>({
        dialect: new PostgreSqlDialect(),
        inboxDialect: new PostgreSqlInboxDialect(),
        adapter: (client) => async (sql, params) => {
          const result = await client.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
      });

      expect(outbox).toBeDefined();
      expect(inbox).toBeDefined();

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const inboxResult = await inbox.receive(
          {
            idempotencyKey: "factory-test-123",
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: { orderId: "order-123" },
          },
          client,
        );

        expect(inboxResult.status).toBe("processed");

        await client.query("COMMIT");
      } finally {
        client.release();
      }
    });
  });
});
