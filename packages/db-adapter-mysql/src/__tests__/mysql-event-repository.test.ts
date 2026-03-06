/**
 * MySQLEventRepository Integration Tests
 *
 * Tests the worker-side repository operations:
 * - claimPendingEvents: Claim events with SKIP LOCKED
 * - getPendingEventCount: Count pending/failed events
 * - markSucceeded: Batch mark succeeded
 * - scheduleRetry: Retry with exponential backoff
 * - moveToDLQ: Move to dead letter queue
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestMySqlPool,
  truncateAllTablesMySql,
} from "@outboxy/testing-utils";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { MySQLEventRepository } from "../repositories/mysql-event.repository.js";

describe("MySQLEventRepository", () => {
  let pool: Pool;
  let repository: MySQLEventRepository;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createIsolatedTestMySqlPool({
      name: "mysql-event-repository",
    });
    pool = result.pool;
    cleanup = result.cleanup;
    repository = new MySQLEventRepository(pool);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTablesMySql(pool);
  });

  describe("claimPendingEvents()", () => {
    it("should claim pending events with SKIP LOCKED", async () => {
      // Create test events
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000002', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
        `,
      );

      // Claim events
      const events = await repository.claimPendingEvents(10);

      expect(events).toHaveLength(2);
      expect(events[0]!.status).toBe("processing");
      expect(events[0]!.aggregateType).toBe("Order");
    });

    it("should also claim failed events past their retry time", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', NOW())
        `,
      );

      const events = await repository.claimPendingEvents(10);

      expect(events).toHaveLength(1);
      expect(events[0]!.status).toBe("processing");
    });

    it("should not claim events not ready for processing", async () => {
      // Failed event with future retry time
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', DATE_ADD(NOW(), INTERVAL 1 HOUR))
        `,
      );

      const events = await repository.claimPendingEvents(10);

      expect(events).toHaveLength(0);
    });

    it("should return empty array when no events available", async () => {
      const events = await repository.claimPendingEvents(10);
      expect(events).toHaveLength(0);
    });

    it("should skip locked rows with FOR UPDATE SKIP LOCKED", async () => {
      // Insert 10 pending events
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000010', 'Order', 'order-0', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000011', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000012', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000013', 'Order', 'order-3', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000014', 'Order', 'order-4', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000015', 'Order', 'order-5', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000016', 'Order', 'order-6', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000017', 'Order', 'order-7', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000018', 'Order', 'order-8', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000019', 'Order', 'order-9', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
        `,
      );

      // Get a separate connection to simulate another worker holding locks
      const lockingConnection = await pool.getConnection();

      try {
        // CRITICAL: Use READ COMMITTED and lock by specific IDs (not ORDER BY)
        // MySQL's ORDER BY + FOR UPDATE locks entire scan range, breaking SKIP LOCKED
        await lockingConnection.query(
          "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED",
        );
        await lockingConnection.beginTransaction();

        // Lock 5 specific rows by ID (simulating another worker that already claimed them)
        const [lockedRows] = await lockingConnection.query(
          `
          SELECT id FROM outbox_events
          WHERE id IN (
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000011',
            '00000000-0000-0000-0000-000000000012',
            '00000000-0000-0000-0000-000000000013',
            '00000000-0000-0000-0000-000000000014'
          )
          FOR UPDATE
          `,
        );

        // Verify we locked 5 rows
        expect(lockedRows).toHaveLength(5);
        const lockedIds = new Set(
          (lockedRows as { id: string }[]).map((r) => r.id),
        );

        // Now try to claim events with the repository (should skip the locked rows)
        const claimedEvents = await repository.claimPendingEvents(10);

        // Should get exactly 5 events (the ones not locked)
        expect(claimedEvents).toHaveLength(5);

        // None of the claimed events should be in the locked set
        for (const event of claimedEvents) {
          expect(lockedIds.has(event.id)).toBe(false);
        }

        // Clean up: rollback the locking transaction
        await lockingConnection.rollback();
      } finally {
        lockingConnection.release();
      }
    });
  });

  describe("getPendingEventCount()", () => {
    it("should count pending events", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('00000000-0000-0000-0000-000000000002', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
        `,
      );

      const count = await repository.getPendingEventCount();
      expect(count).toBe(2);
    });

    it("should count failed events past their retry time", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', NOW())
        `,
      );

      const count = await repository.getPendingEventCount();
      expect(count).toBe(1);
    });

    it("should return 0 when no events pending", async () => {
      const count = await repository.getPendingEventCount();
      expect(count).toBe(0);
    });
  });

  describe("markSucceeded()", () => {
    it("should mark events as succeeded with worker ID", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        `,
      );
      const eventId = "00000000-0000-0000-0000-000000000001";

      // Mark succeeded
      await repository.markSucceeded([{ eventId, workerId: "worker-1" }]);

      // Verify
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT status, processed_by_worker FROM outbox_events WHERE id = ?",
        [eventId],
      );

      expect(rows[0]!.status).toBe("succeeded");
      expect(rows[0]!.processed_by_worker).toBe("worker-1");
    });

    it("should handle empty array", async () => {
      // Should not throw
      await repository.markSucceeded([]);
    });

    it("should mark multiple events with different worker IDs", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing'),
          ('00000000-0000-0000-0000-000000000002', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        `,
      );

      const eventId1 = "00000000-0000-0000-0000-000000000001";
      const eventId2 = "00000000-0000-0000-0000-000000000002";

      await repository.markSucceeded([
        { eventId: eventId1, workerId: "worker-1" },
        { eventId: eventId2, workerId: "worker-2" },
      ]);

      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, processed_by_worker FROM outbox_events WHERE id IN (?, ?) ORDER BY id",
        [eventId1, eventId2],
      );

      expect(rows[0]!.processed_by_worker).toBe("worker-1");
      expect(rows[1]!.processed_by_worker).toBe("worker-2");
    });
  });

  describe("scheduleRetry()", () => {
    it("should mark event as failed with next retry time", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, retry_count, max_retries
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', 0, 5)
        `,
      );
      const eventId = "00000000-0000-0000-0000-000000000001";

      const errorMessages = new Map([[eventId, "Temporary error"]]);
      await repository.scheduleRetry([eventId], errorMessages, {
        backoffBaseMs: 1000,
        backoffMultiplier: 2,
      });

      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT status, retry_count, next_retry_at, last_error FROM outbox_events WHERE id = ?",
        [eventId],
      );

      expect(rows[0]!.status).toBe("failed");
      expect(rows[0]!.retry_count).toBe(1);
      expect(rows[0]!.last_error).toBe("Temporary error");
      expect(rows[0]!.next_retry_at).not.toBeNull();
    });

    it("should not update events when max retries exceeded (must call moveToDLQ explicitly)", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, retry_count, max_retries
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', 5, 5)
        `,
      );
      const eventId = "00000000-0000-0000-0000-000000000001";

      const errorMessages = new Map([[eventId, "Final error"]]);
      // scheduleRetry doesn't update events that exceeded max retries
      await repository.scheduleRetry([eventId], errorMessages, {
        backoffBaseMs: 1000,
        backoffMultiplier: 2,
      });

      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT status FROM outbox_events WHERE id = ?",
        [eventId],
      );

      // Event stays in 'processing' - must call moveToDLQ explicitly
      expect(rows[0]!.status).toBe("processing");

      // Now explicitly move to DLQ
      await repository.moveToDLQ([eventId], errorMessages);

      const [dlqRows] = await pool.query<RowDataPacket[]>(
        "SELECT status, last_error FROM outbox_events WHERE id = ?",
        [eventId],
      );

      expect(dlqRows[0]!.status).toBe("dlq");
      expect(dlqRows[0]!.last_error).toBe("Final error");
    });

    it("should handle empty array", async () => {
      await repository.scheduleRetry([], new Map(), {
        backoffBaseMs: 1000,
        backoffMultiplier: 2,
      });
    });
  });

  describe("moveToDLQ()", () => {
    it("should move events to dead letter queue", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing'),
          ('00000000-0000-0000-0000-000000000002', 'Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        `,
      );

      const eventId1 = "00000000-0000-0000-0000-000000000001";
      const eventId2 = "00000000-0000-0000-0000-000000000002";

      const errorMessages = new Map([
        [eventId1, "Error 1"],
        [eventId2, "Error 2"],
      ]);

      await repository.moveToDLQ([eventId1, eventId2], errorMessages);

      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, status, last_error FROM outbox_events WHERE id IN (?, ?) ORDER BY id",
        [eventId1, eventId2],
      );

      expect(rows[0]!.status).toBe("dlq");
      expect(rows[0]!.last_error).toBe("Error 1");
      expect(rows[1]!.status).toBe("dlq");
      expect(rows[1]!.last_error).toBe("Error 2");
    });

    it("should handle empty array", async () => {
      await repository.moveToDLQ([], new Map());
    });

    it("should use default error message when not provided", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES ('00000000-0000-0000-0000-000000000001', 'Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        `,
      );
      const eventId = "00000000-0000-0000-0000-000000000001";

      await repository.moveToDLQ([eventId], new Map());

      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT last_error FROM outbox_events WHERE id = ?",
        [eventId],
      );

      expect(rows[0]!.last_error).toBe("Moved to DLQ");
    });
  });
});
