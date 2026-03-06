/**
 * Publish Integration Tests
 *
 * Tests for the publish() method with new API-parity fields.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  truncateAllTables,
} from "@outboxy/testing-utils";
import type { Pool, PoolClient } from "pg";
import { PostgresDialect } from "@outboxy/dialect-postgres";
import { OutboxyClient, OutboxyValidationError } from "../../index.js";

describe("publish() with new fields", () => {
  let pool: Pool;
  let client: OutboxyClient<PoolClient>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createIsolatedTestPool({ name: "sdk-publish" });
    pool = result.pool;
    cleanup = result.cleanup;
    client = new OutboxyClient<PoolClient>({
      dialect: new PostgresDialect(),
      adapter: (executor: PoolClient) => async (sql, params) => {
        const result = await executor.query(sql, params);
        return result.rows as { id: string }[];
      },
      defaultDestinationUrl: "https://webhook.example.com",
    });
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  // Helper to run publish with a connection
  const publishWithConnection = async <T>(
    fn: (conn: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const conn = await pool.connect();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  };

  describe("eventVersion", () => {
    it("should default eventVersion to 1", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: { total: 100 },
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should accept custom eventVersion", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: { total: 100 },
            eventVersion: 2,
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should reject eventVersion < 1", async () => {
      await expect(
        publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-123",
              eventType: "OrderCreated",
              payload: {},
              eventVersion: 0,
            },
            conn,
          ),
        ),
      ).rejects.toThrow(OutboxyValidationError);

      await expect(
        publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-123",
              eventType: "OrderCreated",
              payload: {},
              eventVersion: -1,
            },
            conn,
          ),
        ),
      ).rejects.toThrow("eventVersion must be a positive integer");
    });

    it("should reject non-integer eventVersion", async () => {
      await expect(
        publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-123",
              eventType: "OrderCreated",
              payload: {},
              eventVersion: 1.5,
            },
            conn,
          ),
        ),
      ).rejects.toThrow("eventVersion must be a positive integer");
    });
  });

  describe("headers", () => {
    it("should default headers to empty object", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: {},
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should accept custom headers", async () => {
      const customHeaders = {
        "X-Custom-Header": "value",
        Authorization: "Bearer token",
      };

      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: {},
            headers: customHeaders,
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should use defaultHeaders from config", async () => {
      const defaultHeaders = { "X-Default": "default-value" };
      const clientWithDefaults = new OutboxyClient<PoolClient>({
        dialect: new PostgresDialect(),
        adapter: (executor: PoolClient) => async (sql, params) => {
          const result = await executor.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
        defaultHeaders,
      });

      const eventId = await publishWithConnection((conn) =>
        clientWithDefaults.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: {},
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should override defaultHeaders with event headers", async () => {
      const clientWithDefaults = new OutboxyClient<PoolClient>({
        dialect: new PostgresDialect(),
        adapter: (executor: PoolClient) => async (sql, params) => {
          const result = await executor.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
        defaultHeaders: { "X-Default": "default-value" },
      });

      const eventHeaders = { "X-Custom": "custom-value" };
      const eventId = await publishWithConnection((conn) =>
        clientWithDefaults.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-789",
            eventType: "OrderCreated",
            payload: {},
            headers: eventHeaders,
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });
  });

  describe("metadata", () => {
    it("should default metadata to empty object", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: {},
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should accept custom metadata", async () => {
      const customMetadata = {
        source: "api-gateway",
        requestId: "req-123",
        userId: "user-456",
      };

      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: {},
            metadata: customMetadata,
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });
  });

  describe("destinationType", () => {
    it("should default destination_type to http when not specified", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-123",
            eventType: "OrderCreated",
            payload: {},
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should accept custom destinationType per event", async () => {
      const types = ["http", "kafka", "sqs", "rabbitmq", "pubsub"] as const;

      for (const type of types) {
        const eventId = await publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: `order-${type}`,
              eventType: "OrderCreated",
              payload: {},
              destinationType: type,
            },
            conn,
          ),
        );

        expect(eventId).toBeDefined();
        expect(typeof eventId).toBe("string");
      }
    });

    it("should use defaultDestinationType from config", async () => {
      const clientWithDefault = new OutboxyClient<PoolClient>({
        dialect: new PostgresDialect(),
        adapter: (executor: PoolClient) => async (sql, params) => {
          const result = await executor.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
        defaultDestinationType: "kafka",
      });

      const eventId = await publishWithConnection((conn) =>
        clientWithDefault.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-456",
            eventType: "OrderCreated",
            payload: {},
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should override defaultDestinationType with event destinationType", async () => {
      const clientWithDefault = new OutboxyClient<PoolClient>({
        dialect: new PostgresDialect(),
        adapter: (executor: PoolClient) => async (sql, params) => {
          const result = await executor.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
        defaultDestinationType: "kafka",
      });

      const eventId = await publishWithConnection((conn) =>
        clientWithDefault.publish(
          {
            aggregateType: "Order",
            aggregateId: "order-789",
            eventType: "OrderCreated",
            payload: {},
            destinationType: "http",
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should reject invalid destinationType at event level", async () => {
      await expect(
        publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-invalid",
              eventType: "OrderCreated",
              payload: {},
              destinationType: "invalid" as never,
            },
            conn,
          ),
        ),
      ).rejects.toThrow(OutboxyValidationError);

      await expect(
        publishWithConnection((conn) =>
          client.publish(
            {
              aggregateType: "Order",
              aggregateId: "order-invalid-2",
              eventType: "OrderCreated",
              payload: {},
              destinationType: "invalid" as never,
            },
            conn,
          ),
        ),
      ).rejects.toThrow(/Invalid destinationType: "invalid"/);
    });

    it("should reject invalid defaultDestinationType in config", () => {
      expect(() => {
        new OutboxyClient<PoolClient>({
          dialect: new PostgresDialect(),
          adapter: (executor: PoolClient) => async (sql, params) => {
            const result = await executor.query(sql, params);
            return result.rows as { id: string }[];
          },
          defaultDestinationType: "invalid" as never,
        });
      }).toThrow(OutboxyValidationError);

      expect(() => {
        new OutboxyClient<PoolClient>({
          dialect: new PostgresDialect(),
          adapter: (executor: PoolClient) => async (sql, params) => {
            const result = await executor.query(sql, params);
            return result.rows as { id: string }[];
          },
          defaultDestinationType: "invalid" as never,
        });
      }).toThrow(/Invalid destinationType: "invalid"/);
    });

    it("should handle mixed destination types in publishBatch", async () => {
      const events = [
        {
          aggregateType: "Order",
          aggregateId: "order-batch-1",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "http" as const,
        },
        {
          aggregateType: "Order",
          aggregateId: "order-batch-2",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "kafka" as const,
        },
        {
          aggregateType: "Order",
          aggregateId: "order-batch-3",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "sqs" as const,
        },
      ];

      const eventIds = await publishWithConnection((conn) =>
        client.publishBatch(events, conn),
      );

      expect(eventIds).toHaveLength(3);
      eventIds.forEach((eventId) => {
        expect(eventId).toBeDefined();
        expect(typeof eventId).toBe("string");
      });
    });

    it("should use defaultDestinationType for batch events without destinationType", async () => {
      const clientWithDefault = new OutboxyClient<PoolClient>({
        dialect: new PostgresDialect(),
        adapter: (executor: PoolClient) => async (sql, params) => {
          const result = await executor.query(sql, params);
          return result.rows as { id: string }[];
        },
        defaultDestinationUrl: "https://webhook.example.com",
        defaultDestinationType: "rabbitmq",
      });

      const events = [
        {
          aggregateType: "Order",
          aggregateId: "order-batch-default-1",
          eventType: "OrderCreated",
          payload: {},
        },
        {
          aggregateType: "Order",
          aggregateId: "order-batch-default-2",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "kafka" as const,
        },
      ];

      const eventIds = await publishWithConnection((conn) =>
        clientWithDefault.publishBatch(events, conn),
      );

      expect(eventIds).toHaveLength(2);
      eventIds.forEach((eventId) => {
        expect(eventId).toBeDefined();
        expect(typeof eventId).toBe("string");
      });
    });

    it("should reject batch with invalid destinationType", async () => {
      const events = [
        {
          aggregateType: "Order",
          aggregateId: "order-batch-valid",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "http" as const,
        },
        {
          aggregateType: "Order",
          aggregateId: "order-batch-invalid",
          eventType: "OrderCreated",
          payload: {},
          destinationType: "invalid" as never,
        },
      ];

      await expect(
        publishWithConnection((conn) => client.publishBatch(events, conn)),
      ).rejects.toThrow(OutboxyValidationError);
    });
  });

  describe("all fields together", () => {
    it("should persist all fields correctly", async () => {
      const eventId = await publishWithConnection((conn) =>
        client.publish(
          {
            aggregateType: "Payment",
            aggregateId: "pay-999",
            eventType: "PaymentCompleted",
            payload: { amount: 9999, currency: "USD" },
            destinationUrl: "https://custom-webhook.example.com/payments",
            idempotencyKey: "pay-999-completed",
            maxRetries: 10,
            eventVersion: 3,
            headers: { "X-API-Key": "secret123" },
            metadata: { source: "checkout-service", region: "us-east-1" },
          },
          conn,
        ),
      );

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });
  });
});
