import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Pool, PoolClient } from "pg";
import { OutboxyModule } from "../../src/outboxy.module.js";
import { OutboxyClient } from "@outboxy/sdk";
import { PostgresDialect } from "@outboxy/dialect-postgres";
import { OUTBOXY_CLIENT } from "../../src/constants.js";
import {
  createIsolatedTestPool,
  truncateAllTables,
} from "@outboxy/testing-utils";

describe("NestJS SDK Integration Tests", () => {
  let module: TestingModule;
  let pool: Pool;
  let client: OutboxyClient<PoolClient>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Create isolated test pool
    const result = await createIsolatedTestPool();
    pool = result.pool;
    cleanup = result.cleanup;

    // Create orders table for test
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        total DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create NestJS module with adapter
    module = await Test.createTestingModule({
      imports: [
        OutboxyModule.forRootAsync({
          useFactory: () => ({
            dialect: new PostgresDialect(),
            adapter: (poolClient: PoolClient) => async (sql, params) => {
              const result = await poolClient.query(sql, params);
              return result.rows as { id: string }[];
            },
            defaultDestinationUrl: "https://webhook.example.com",
          }),
        }),
      ],
    }).compile();

    client = module.get(OUTBOXY_CLIENT);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await pool.query("TRUNCATE TABLE orders RESTART IDENTITY CASCADE");
  });

  describe("OutboxyModule with adapter", () => {
    it("should have OutboxyClient available", () => {
      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(OutboxyClient);
    });
  });

  describe("OutboxyClient.publish", () => {
    it("should insert event into outbox_events table", async () => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");

        const eventId = await client.publish(
          {
            aggregateType: "Order",
            aggregateId: "123",
            eventType: "OrderCreated",
            payload: { total: 100 },
            destinationUrl: "https://webhook.example.com",
          },
          poolClient,
        );

        await poolClient.query("COMMIT");

        expect(eventId).toBeDefined();
        expect(typeof eventId).toBe("string");

        // Verify event in database
        const result = await pool.query(
          "SELECT * FROM outbox_events WHERE id = $1",
          [eventId],
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].aggregate_type).toBe("Order");
        expect(result.rows[0].aggregate_id).toBe("123");
        expect(result.rows[0].event_type).toBe("OrderCreated");
        expect(result.rows[0].status).toBe("pending");
      } catch (error) {
        await poolClient.query("ROLLBACK");
        throw error;
      } finally {
        poolClient.release();
      }
    });
  });

  describe("OutboxyClient.publishBatch", () => {
    it("should insert multiple events in single query", async () => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");

        const eventIds = await client.publishBatch(
          [
            {
              aggregateType: "Order",
              aggregateId: "1",
              eventType: "OrderCreated",
              payload: { total: 100 },
              destinationUrl: "https://webhook.example.com",
            },
            {
              aggregateType: "Order",
              aggregateId: "2",
              eventType: "OrderCreated",
              payload: { total: 200 },
              destinationUrl: "https://webhook.example.com",
            },
          ],
          poolClient,
        );

        await poolClient.query("COMMIT");

        expect(eventIds).toHaveLength(2);

        // Verify events in database
        const result = await pool.query(
          "SELECT * FROM outbox_events WHERE id = ANY($1) ORDER BY created_at",
          [eventIds],
        );

        expect(result.rows).toHaveLength(2);
      } catch (error) {
        await poolClient.query("ROLLBACK");
        throw error;
      } finally {
        poolClient.release();
      }
    });
  });

  describe("Transaction semantics", () => {
    it("should commit order and event atomically", async () => {
      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");

        // Insert order
        const result = await poolClient.query(
          "INSERT INTO orders (customer_id, total) VALUES ($1, $2) RETURNING id",
          ["customer-123", 150],
        );
        const orderRow = result.rows[0] as { id: string };

        // Publish event atomically
        await client.publish(
          {
            aggregateType: "Order",
            aggregateId: orderRow.id,
            eventType: "OrderCreated",
            payload: { customerId: "customer-123", total: 150 },
            destinationUrl: "https://webhook.example.com/orders",
          },
          poolClient,
        );

        await poolClient.query("COMMIT");

        expect(orderRow.id).toBeDefined();

        // Verify order in database
        const orderResult = await pool.query(
          "SELECT * FROM orders WHERE id = $1",
          [orderRow.id],
        );
        expect(orderResult.rows).toHaveLength(1);

        // Verify event in database
        const eventResult = await pool.query(
          "SELECT * FROM outbox_events WHERE aggregate_id = $1",
          [orderRow.id],
        );
        expect(eventResult.rows).toHaveLength(1);
        expect(eventResult.rows[0].aggregate_type).toBe("Order");
        expect(eventResult.rows[0].event_type).toBe("OrderCreated");
      } catch (error) {
        await poolClient.query("ROLLBACK");
        throw error;
      } finally {
        poolClient.release();
      }
    });

    it("should rollback on error", async () => {
      const initialOrderCount = await pool.query("SELECT COUNT(*) FROM orders");
      const initialEventCount = await pool.query(
        "SELECT COUNT(*) FROM outbox_events",
      );

      const poolClient = await pool.connect();
      try {
        await poolClient.query("BEGIN");
        await poolClient.query(
          "INSERT INTO orders (customer_id, total) VALUES ($1, $2)",
          ["test", 100],
        );
        throw new Error("Simulated failure");
      } catch {
        await poolClient.query("ROLLBACK");
      } finally {
        poolClient.release();
      }

      // Verify order was NOT inserted (rolled back)
      const finalOrderCount = await pool.query("SELECT COUNT(*) FROM orders");
      const finalEventCount = await pool.query(
        "SELECT COUNT(*) FROM outbox_events",
      );

      expect(parseInt(finalOrderCount.rows[0].count)).toBe(
        parseInt(initialOrderCount.rows[0].count),
      );
      expect(parseInt(finalEventCount.rows[0].count)).toBe(
        parseInt(initialEventCount.rows[0].count),
      );
    });
  });
});
