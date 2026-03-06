/**
 * MySQLAdapter Integration Tests
 *
 * Tests the adapter lifecycle and basic operations.
 * Detailed repository and service tests are in separate files.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestMySqlPool,
  truncateAllTablesMySql,
  getTestMySqlConnectionString,
} from "@outboxy/testing-utils";
import type { Pool } from "mysql2/promise";
import { createMySQLAdapter, MySQLAdapter, canHandle } from "../index.js";
import type { Logger } from "../config.js";

describe("MySQLAdapter", () => {
  let pool: Pool;
  let cleanup: () => Promise<void>;

  const testLogger: Logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    const result = await createIsolatedTestMySqlPool({ name: "mysql-adapter" });
    pool = result.pool;
    cleanup = result.cleanup;
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTablesMySql(pool);
  });

  describe("createMySQLAdapter()", () => {
    it("should create and initialize adapter", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      expect(adapter).toBeInstanceOf(MySQLAdapter);

      // Should be able to check health
      const health = await adapter.checkHealth();
      expect(health.healthy).toBe(true);

      // Cleanup
      await adapter.shutdown();
    });
  });

  describe("canHandle()", () => {
    it("should return true for mysql connection strings", () => {
      expect(canHandle("mysql://localhost/db")).toBe(true);
      expect(canHandle("mysql://user:pass@host:3306/db")).toBe(true);
    });

    it("should return false for non-mysql connection strings", () => {
      expect(canHandle("postgresql://localhost/db")).toBe(false);
      expect(canHandle("postgres://localhost/db")).toBe(false);
      expect(canHandle("http://example.com")).toBe(false);
    });
  });

  describe("eventRepository", () => {
    it("should provide access to event repository", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
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
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      expect(adapter.eventService).toBeDefined();
      expect(typeof adapter.eventService.createEvent).toBe("function");

      await adapter.shutdown();
    });
  });

  describe("maintenance", () => {
    it("should provide access to maintenance operations", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      expect(adapter.maintenance).toBeDefined();
      expect(typeof adapter.maintenance.recoverStaleEvents).toBe("function");

      await adapter.shutdown();
    });
  });

  describe("checkHealth()", () => {
    it("should return healthy when connected", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      const health = await adapter.checkHealth();

      expect(health.healthy).toBe(true);

      await adapter.shutdown();
    });

    it("should return unhealthy when not initialized", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = new MySQLAdapter({
        connectionString,
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
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
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

  describe("getClient()", () => {
    it("should return the underlying pool", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = await createMySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      const client = adapter.getClient();
      expect(client).toBeDefined();
      expect(client).toHaveProperty("query");
      expect(client).toHaveProperty("end");

      await adapter.shutdown();
    });

    it("should throw if not initialized", async () => {
      const connectionString = getTestMySqlConnectionString();
      const adapter = new MySQLAdapter({
        connectionString,
        logger: testLogger,
      });

      expect(() => adapter.getClient()).toThrow("MySQLAdapter not initialized");
    });
  });
});
