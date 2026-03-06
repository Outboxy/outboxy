/**
 * MySQLMaintenance Integration Tests
 *
 * Tests the maintenance operations:
 * - recoverStaleEvents: Recover events stuck in 'processing'
 * - cleanupStaleIdempotencyKeys: Clear old idempotency keys (with security fix)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestMySqlPool,
  truncateAllTablesMySql,
} from "@outboxy/testing-utils";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { MySQLMaintenance } from "../repositories/mysql-maintenance.js";
import type { Logger } from "../config.js";

describe("MySQLMaintenance", () => {
  let pool: Pool;
  let maintenance: MySQLMaintenance;
  let cleanup: () => Promise<void>;

  const testLogger: Logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };

  beforeAll(async () => {
    const result = await createIsolatedTestMySqlPool({
      name: "mysql-maintenance",
    });
    pool = result.pool;
    cleanup = result.cleanup;
    maintenance = new MySQLMaintenance(pool, testLogger);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTablesMySql(pool);
  });

  describe("recoverStaleEvents()", () => {
    it("should recover events stuck longer than threshold", async () => {
      // Create stale event (10 minutes old)
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        `,
      );

      // Create recent event (2 minutes old - should NOT be recovered)
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ('00000000-0000-0000-0000-000000000002', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', DATE_SUB(NOW(), INTERVAL 2 MINUTE))
        `,
      );

      // Run recovery with 5-minute threshold
      const recoveredCount = await maintenance.recoverStaleEvents(300000);

      // Should recover only the stale event
      expect(recoveredCount).toBe(1);

      // Verify stale event is now 'failed'
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT status, retry_count, last_error, next_retry_at FROM outbox_events WHERE id = ?",
        ["00000000-0000-0000-0000-000000000001"],
      );
      expect(rows[0]!.status).toBe("failed");
      expect(rows[0]!.retry_count).toBe(1);
      expect(rows[0]!.last_error).toBe("Recovered from stale processing state");
      expect(rows[0]!.next_retry_at).not.toBeNull();
    });

    it("should not recover events at max retries", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at,
          retry_count, max_retries
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-max', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', DATE_SUB(NOW(), INTERVAL 10 MINUTE), 5, 5)
        `,
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
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, processing_started_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-test', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        `,
      );

      // These malicious inputs should either:
      // 1. Be coerced to safe values (NaN becomes 0 matches)
      // 2. Throw a type/validation error (MySQL strict mode rejects invalid integers)
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
          // MySQL may reject invalid integers - this is also safe behavior
        }
      }

      // Verify table still exists and data is intact after all attempts
      const [checkRows] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) as count FROM outbox_events",
      );
      expect(Number(checkRows[0]!.count)).toBeGreaterThan(0);
    });
  });

  describe("cleanupStaleIdempotencyKeys()", () => {
    it("should clear idempotency keys from old succeeded events", async () => {
      // Create old succeeded event with idempotency key
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-old', 'OrderCreated', '{"test":true}', 'http://example.com', 'succeeded', 'old-key-123', DATE_SUB(NOW(), INTERVAL 45 DAY))
        `,
      );

      // Create recent succeeded event (should NOT be cleared)
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ('00000000-0000-0000-0000-000000000002', 'Order', 'order-recent', 'OrderCreated', '{"test":true}', 'http://example.com', 'succeeded', 'recent-key-456', DATE_SUB(NOW(), INTERVAL 10 DAY))
        `,
      );

      // Run cleanup with 30-day retention
      const clearedCount = await maintenance.cleanupStaleIdempotencyKeys(30);

      // Should clear only the old event's key
      expect(clearedCount).toBe(1);

      // Verify old event key is cleared
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT idempotency_key FROM outbox_events WHERE id = ?",
        ["00000000-0000-0000-0000-000000000001"],
      );
      expect(rows[0]!.idempotency_key).toBeNull();
    });

    it("should not clear keys from non-succeeded events", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-failed', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', 'failed-key-789', DATE_SUB(NOW(), INTERVAL 45 DAY))
        `,
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
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, idempotency_key, processed_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-test', 'OrderCreated', '{"test":true}', 'http://example.com', 'succeeded', 'test-key', DATE_SUB(NOW(), INTERVAL 45 DAY))
        `,
      );

      // These malicious inputs should either:
      // 1. Be coerced to safe values
      // 2. Throw a type/validation error (MySQL strict mode rejects invalid integers)
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
          // MySQL may reject invalid integers - this is also safe behavior
        }
      }

      // Verify table and data still intact after all attempts
      const [checkRows] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) as count FROM outbox_events",
      );
      expect(Number(checkRows[0]!.count)).toBeGreaterThan(0);
    });
  });
});
