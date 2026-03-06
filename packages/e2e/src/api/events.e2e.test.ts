/**
 * Events API E2E Tests
 *
 * Validates:
 * 1. Event retrieval by ID
 * 2. Error handling for invalid UUIDs
 * 3. 404 responses for non-existent events
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

describe("Events API E2E Tests", () => {
  let server: FastifyInstance;
  let adapter: PostgresAdapter;
  let pool: Pool;
  let cleanupPool: () => Promise<void>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({ name: "events-api-e2e" });
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
   * Helper to create an event directly in the database.
   * This simulates the SDK's direct DB write pattern.
   */
  async function createEventDirectly(
    overrides: Partial<{
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
      destinationUrl: string;
    }> = {},
  ) {
    const result = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload,
        destination_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        overrides.aggregateType ?? "Order",
        overrides.aggregateId ?? "order-456",
        overrides.eventType ?? "OrderCreated",
        JSON.stringify(overrides.payload ?? { orderId: "order-456" }),
        overrides.destinationUrl ?? "https://example.com/webhook",
        "pending",
      ],
    );
    return result.rows[0].id;
  }

  describe("GET /events/:id", () => {
    it("should return event details for existing event", async () => {
      const id = await createEventDirectly();

      const response = await server.inject({
        method: "GET",
        url: `/events/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(id);
      expect(body.aggregateType).toBe("Order");
      expect(body.aggregateId).toBe("order-456");
      expect(body.eventType).toBe("OrderCreated");
      expect(body.status).toBe("pending");
    });

    it("should return 404 for non-existent event", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/events/00000000-0000-0000-0000-000000000000",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 for invalid UUID", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/events/not-a-uuid",
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
