/**
 * PostgresAdapter Integration Tests
 *
 * Tests the adapter lifecycle and basic operations.
 * Detailed repository and service tests are in separate files.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  truncateAllTables,
  getTestContainerConfig,
} from "@outboxy/testing-utils";
import type { Pool } from "pg";
import { createPostgresAdapter, PostgresAdapter } from "../index.js";
import type { Logger } from "../config.js";

describe("PostgresAdapter", () => {
  let pool: Pool;
  let cleanup: () => Promise<void>;

  const testLogger: Logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    const result = await createIsolatedTestPool({ name: "postgres-adapter" });
    pool = result.pool;
    cleanup = result.cleanup;
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe("createPostgresAdapter()", () => {
    it("should create and initialize adapter", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      expect(adapter).toBeInstanceOf(PostgresAdapter);

      // Should be able to check health
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.totalConnections).toBeGreaterThan(0);

      // Cleanup
      await adapter.shutdown();
    });
  });

  describe("eventRepository", () => {
    it("should provide access to event repository", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      expect(adapter.eventRepository).toBeDefined();
      expect(typeof adapter.eventRepository.claimPendingEvents).toBe(
        "function",
      );

      await adapter.shutdown();
    });
  });

  describe("eventService", () => {
    it("should provide access to event service", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      expect(adapter.eventService).toBeDefined();
      expect(typeof adapter.eventService.createEvent).toBe("function");

      await adapter.shutdown();
    });
  });

  describe("maintenance", () => {
    it("should provide access to maintenance operations", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      expect(adapter.maintenance).toBeDefined();
      expect(typeof adapter.maintenance.recoverStaleEvents).toBe("function");

      await adapter.shutdown();
    });
  });

  describe("checkHealth()", () => {
    it("should return healthy when connected", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      const health = await adapter.checkHealth();

      expect(health.healthy).toBe(true);
      expect(typeof health.totalConnections).toBe("number");
      expect(typeof health.idleConnections).toBe("number");
      expect(typeof health.waitingClients).toBe("number");

      await adapter.shutdown();
    });

    it("should return unhealthy when not initialized", async () => {
      const config = getTestContainerConfig();
      const adapter = new PostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      // Don't initialize - check health
      const health = await adapter.checkHealth();

      expect(health.healthy).toBe(false);
      expect(health.error).toBe("Adapter not initialized");
    });
  });

  describe("shutdown()", () => {
    it("should shutdown gracefully", async () => {
      const config = getTestContainerConfig();
      const adapter = await createPostgresAdapter({
        connectionString: config.pgConnectionString,
        logger: testLogger,
      });

      // Verify connected
      const healthBefore = await adapter.checkHealth();
      expect(healthBefore.healthy).toBe(true);

      // Shutdown
      await adapter.shutdown();

      // Verify disconnected
      const healthAfter = await adapter.checkHealth();
      expect(healthAfter.healthy).toBe(false);
    });
  });
});
