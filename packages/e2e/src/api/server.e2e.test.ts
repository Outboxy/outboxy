/**
 * API Server E2E Tests
 *
 * Validates basic server functionality:
 * 1. Server creation
 * 2. Health endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe("API Server E2E Tests", () => {
  let server: FastifyInstance;
  let adapter: PostgresAdapter;
  let pool: Pool;
  let cleanupPool: () => Promise<void>;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({ name: "server-e2e" });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    const connectionString = getTestPgConnectionStringWithSchema(
      isolated.schemaName,
    );

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
    });

    await pool.query("TRUNCATE outbox_events CASCADE");

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

  it("should create Fastify server instance", async () => {
    expect(server).toBeDefined();
  });

  it("should have health endpoint", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toHaveProperty("status", "ok");
  });
});
