/**
 * Admin API E2E Tests
 *
 * Validates:
 * 1. Replay single failed/DLQ events
 * 2. Replay events in date range with filtering
 * 3. Error handling for invalid replay requests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  type Pool,
} from "@outboxy/testing-utils";
import {
  createPostgresAdapter,
  type PostgresAdapter,
} from "@outboxy/db-adapter-postgres";
import { createServer } from "@outboxy/api";
import { createTestConfig } from "./test-helpers.js";

describe("Admin API E2E Tests", () => {
  let server: FastifyInstance;
  let adapter: PostgresAdapter;
  let pool: Pool;
  let cleanupPool: () => Promise<void>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({ name: "admin-api-e2e" });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    const connectionString = getTestPgConnectionStringWithSchema(
      isolated.schemaName,
    );

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
    });

    server = await createServer({
      adapter,
      config: createTestConfig(),
    });
  });

  afterAll(async () => {
    await server.close();
    await adapter.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
  });

  /**
   * Helper to insert a test event directly via SQL
   * (POST /events doesn't exist - SDK handles event creation)
   */
  async function insertTestEvent(options: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    status?: string;
  }): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        options.aggregateType,
        options.aggregateId,
        options.eventType,
        JSON.stringify(options.payload ?? {}),
        "https://example.com/webhook",
        options.status ?? "pending",
      ],
    );
    return rows[0].id;
  }

  describe("POST /admin/replay/:id", () => {
    it("should replay a failed event", async () => {
      const id = await insertTestEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: { orderId: "order-123" },
        status: "failed",
      });

      await pool.query(
        `UPDATE outbox_events SET last_error = 'Test error' WHERE id = $1`,
        [id],
      );

      const response = await server.inject({
        method: "POST",
        url: `/admin/replay/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(id);
      expect(body.previousStatus).toBe("failed");
      expect(body.newStatus).toBe("pending");
      expect(body).toHaveProperty("replayedAt");
    });

    it("should replay a DLQ event", async () => {
      const id = await insertTestEvent({
        aggregateType: "Order",
        aggregateId: "order-456",
        eventType: "OrderCreated",
        payload: { orderId: "order-456" },
        status: "dlq",
      });

      await pool.query(
        `UPDATE outbox_events SET last_error = 'Max retries exceeded' WHERE id = $1`,
        [id],
      );

      const response = await server.inject({
        method: "POST",
        url: `/admin/replay/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.previousStatus).toBe("dlq");
      expect(body.newStatus).toBe("pending");
    });

    it("should return 422 for pending event", async () => {
      const id = await insertTestEvent({
        aggregateType: "Order",
        aggregateId: "order-789",
        eventType: "OrderCreated",
        payload: { orderId: "order-789" },
        status: "pending",
      });

      const response = await server.inject({
        method: "POST",
        url: `/admin/replay/${id}`,
      });

      expect(response.statusCode).toBe(422);
    });

    it("should return 404 for non-existent event", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/admin/replay/00000000-0000-0000-0000-000000000000",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /admin/replay/range", () => {
    it("should replay events in date range", async () => {
      const events: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await insertTestEvent({
          aggregateType: "Order",
          aggregateId: `order-${i}`,
          eventType: "OrderCreated",
          payload: { orderId: `order-${i}` },
          status: "dlq",
        });
        events.push(id);
      }

      const now = Date.now();
      const startDate = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now + 2 * 60 * 60 * 1000).toISOString();

      const response = await server.inject({
        method: "POST",
        url: "/admin/replay/range",
        payload: {
          startDate,
          endDate,
          status: "dlq",
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.replayedCount).toBe(3);
      expect(body.eventIds).toHaveLength(3);
      expect(body.eventIds).toEqual(expect.arrayContaining(events));
    });

    it("should filter by aggregate type", async () => {
      for (const aggType of ["Order", "User", "Order"]) {
        await insertTestEvent({
          aggregateType: aggType,
          aggregateId: `${aggType.toLowerCase()}-${Date.now()}-${Math.random()}`,
          eventType: `${aggType}Created`,
          payload: {},
          status: "dlq",
        });
      }

      const now = Date.now();
      const startDate = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now + 2 * 60 * 60 * 1000).toISOString();

      const response = await server.inject({
        method: "POST",
        url: "/admin/replay/range",
        payload: {
          startDate,
          endDate,
          status: "dlq",
          aggregateType: "Order",
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.replayedCount).toBe(2);
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertTestEvent({
          aggregateType: "Order",
          aggregateId: `order-${i}`,
          eventType: "OrderCreated",
          payload: {},
          status: "dlq",
        });
      }

      const now = Date.now();
      const startDate = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now + 2 * 60 * 60 * 1000).toISOString();

      const response = await server.inject({
        method: "POST",
        url: "/admin/replay/range",
        payload: {
          startDate,
          endDate,
          status: "dlq",
          limit: 2,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.replayedCount).toBe(2);
    });
  });
});
