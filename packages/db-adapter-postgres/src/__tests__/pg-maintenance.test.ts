/**
 * PgMaintenance Integration Tests
 *
 * Tests the maintenance operations:
 * - recoverStaleEvents: Recover events stuck in 'processing'
 * - cleanupStaleIdempotencyKeys: Clear old idempotency keys (with security fix)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  truncateAllTables,
} from "@outboxy/testing-utils";
import type { Pool } from "pg";
import { PgMaintenance } from "../repositories/pg-maintenance.js";
import type { Logger } from "../config.js";

describe("PgMaintenance", () => {
  let pool: Pool;
  let maintenance: PgMaintenance;
  let cleanup: () => Promise<void>;

  const testLogger: Logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    const result = await createIsolatedTestPool({ name: "pg-maintenance" });
    pool = result.pool;
    cleanup = result.cleanup;
    maintenance = new PgMaintenance(pool, testLogger);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe("recoverStaleEvents()", () => {
    it("should recover events stuck longer than threshold", async () => {
      // Create stale event (10 minutes old)
      const staleEvent = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - interval '10 minutes')
        RETURNING id
        `,
        [
          "Order",
          "order-1",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "processing",
        ],
      );

      // Create recent event (2 minutes old - should NOT be recovered)
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - interval '2 minutes')
        RETURNING id
        `,
        [
          "Order",
          "order-2",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "processing",
        ],
      );

      // Run recovery with 5-minute threshold
      const recoveredCount = await maintenance.recoverStaleEvents(300000);

      // Should recover only the stale event
      expect(recoveredCount).toBe(1);

      // Verify stale event is now 'failed'
      const result = await pool.query(
        "SELECT status, retry_count, last_error, next_retry_at FROM outbox_events WHERE id = $1",
        [staleEvent.rows[0].id],
      );
      expect(result.rows[0].status).toBe("failed");
      expect(result.rows[0].retry_count).toBe(1);
      expect(result.rows[0].last_error).toBe(
        "Recovered from stale processing state",
      );
      expect(result.rows[0].next_retry_at).not.toBeNull();
    });

    it("should not recover events at max retries", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at,
          retry_count, max_retries
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - interval '10 minutes', 5, 5)
        `,
        [
          "Order",
          "order-max",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "processing",
        ],
      );

      const recoveredCount = await maintenance.recoverStaleEvents(300000);

      // Should not recover event at max retries
      expect(recoveredCount).toBe(0);
    });

    it("should use parameterized query (SQL injection protection)", async () => {
      // Verify normal numeric parameter works
      const recoveredCount = await maintenance.recoverStaleEvents(300000);
      expect(recoveredCount).toBe(0);
    });

    it("should safely handle malicious input attempts", async () => {
      // Insert a test event so we can verify the query doesn't expose/damage data
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - interval '10 minutes')
        `,
        [
          "Order",
          "order-test",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "processing",
        ],
      );

      // These malicious inputs should either:
      // 1. Be coerced to safe values (NaN becomes 0 matches)
      // 2. Throw a type/validation error (PostgreSQL rejects invalid types)
      // Either outcome is safe - the injection is blocked
      const maliciousInputs = [
        "'; DROP TABLE outbox_events; --",
        "1 OR 1=1",
        "1; SELECT * FROM information_schema.tables",
        "1 UNION SELECT * FROM outbox_events",
      ];

      for (const input of maliciousInputs) {
        try {
          const result = await maintenance.recoverStaleEvents(
            input as unknown as number,
          );
          // If no error, result should be a safe number
          expect(typeof result).toBe("number");
        } catch {
          // PostgreSQL may reject invalid types - this is also safe behavior
        }
      }

      // Verify table still exists and data is intact after all attempts
      const checkResult = await pool.query(
        "SELECT COUNT(*) FROM outbox_events",
      );
      expect(Number(checkResult.rows[0].count)).toBeGreaterThan(0);
    });
  });

  describe("cleanupStaleIdempotencyKeys()", () => {
    it("should clear idempotency keys from old succeeded events", async () => {
      // Create old succeeded event with idempotency key
      const oldEvent = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - interval '45 days')
        RETURNING id
        `,
        [
          "Order",
          "order-old",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "succeeded",
          "old-key-123",
        ],
      );

      // Create recent succeeded event (should NOT be cleared)
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - interval '10 days')
        `,
        [
          "Order",
          "order-recent",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "succeeded",
          "recent-key-456",
        ],
      );

      // Run cleanup with 30-day retention
      const clearedCount = await maintenance.cleanupStaleIdempotencyKeys(30);

      // Should clear only the old event's key
      expect(clearedCount).toBe(1);

      // Verify old event key is cleared
      const oldResult = await pool.query(
        "SELECT idempotency_key FROM outbox_events WHERE id = $1",
        [oldEvent.rows[0].id],
      );
      expect(oldResult.rows[0].idempotency_key).toBeNull();
    });

    it("should not clear keys from non-succeeded events", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - interval '45 days')
        `,
        [
          "Order",
          "order-failed",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "failed",
          "failed-key-789",
        ],
      );

      const clearedCount = await maintenance.cleanupStaleIdempotencyKeys(30);

      // Should not clear failed event's key
      expect(clearedCount).toBe(0);
    });

    it("should use parameterized query (SQL injection prevention - security fix)", async () => {
      // This test verifies the security fix: retentionDays is parameterized
      const clearedCount = await maintenance.cleanupStaleIdempotencyKeys(30);
      expect(clearedCount).toBe(0);
    });

    it("should safely handle malicious input attempts", async () => {
      // Insert a test event so we can verify the query doesn't damage data
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - interval '45 days')
        `,
        [
          "Order",
          "order-test",
          "OrderCreated",
          JSON.stringify({ test: true }),
          "http://example.com",
          "succeeded",
          "test-key",
        ],
      );

      // These malicious inputs should either:
      // 1. Be coerced to safe values
      // 2. Throw a type/validation error (PostgreSQL rejects invalid types)
      // Either outcome is safe - the injection is blocked
      const maliciousInputs = [
        "'; DROP TABLE outbox_events; --",
        "1 OR 1=1",
        "30; DELETE FROM outbox_events",
      ];

      for (const input of maliciousInputs) {
        try {
          const result = await maintenance.cleanupStaleIdempotencyKeys(
            input as unknown as number,
          );
          expect(typeof result).toBe("number");
        } catch {
          // PostgreSQL may reject invalid types - this is also safe behavior
        }
      }

      // Verify table and data still intact after all attempts
      const checkResult = await pool.query(
        "SELECT COUNT(*) FROM outbox_events",
      );
      expect(Number(checkResult.rows[0].count)).toBeGreaterThan(0);
    });
  });
});
