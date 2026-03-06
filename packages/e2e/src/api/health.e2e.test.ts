/**
 * Health API E2E Tests
 *
 * Validates:
 * 1. Health endpoint returns OK status
 * 2. Ready endpoint checks database connectivity
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestPgConnectionString } from "@outboxy/testing-utils";
import {
  createPostgresAdapter,
  type PostgresAdapter,
} from "@outboxy/db-adapter-postgres";
import { createServer } from "@outboxy/api";
import { createTestConfig } from "./test-helpers.js";

describe("Health API E2E Tests", () => {
  let server: FastifyInstance;
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    adapter = await createPostgresAdapter({
      connectionString: getTestPgConnectionString(),
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
  });

  describe("GET /health", () => {
    it("should return healthy status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body).toHaveProperty("timestamp");
      expect(body).toHaveProperty("version");
    });
  });

  describe("GET /ready", () => {
    it("should return ready when database is connected", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/ready",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body.database.healthy).toBe(true);
      expect(body.database).toHaveProperty("totalConnections");
      expect(body.database).toHaveProperty("idleConnections");
    });
  });
});
