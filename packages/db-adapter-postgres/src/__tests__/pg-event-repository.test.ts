/**
 * PgEventRepository Integration Tests
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
  createIsolatedTestPool,
  truncateAllTables,
} from "@outboxy/testing-utils";
import type { Pool } from "pg";
import { PgEventRepository } from "../repositories/pg-event.repository.js";

describe("PgEventRepository", () => {
  let pool: Pool;
  let repository: PgEventRepository;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createIsolatedTestPool({
      name: "pg-event-repository",
    });
    pool = result.pool;
    cleanup = result.cleanup;
    repository = new PgEventRepository(pool);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe("claimPendingEvents()", () => {
    it("should claim pending events with SKIP LOCKED", async () => {
      // Create test events
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
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
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', NOW())
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
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', NOW() + INTERVAL '1 hour')
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
      for (let i = 0; i < 10; i++) {
        await pool.query(
          `
          INSERT INTO outbox_events (
            aggregate_type, aggregate_id, event_type, payload,
            destination_url, status
          ) VALUES ('Order', $1, 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
          `,
          [`order-${i}`],
        );
      }

      // Get a separate client to simulate another worker holding locks
      const lockingClient = await pool.connect();

      try {
        // Start a transaction and lock 5 rows (simulating worker 1 in-flight)
        await lockingClient.query("BEGIN");
        const lockedResult = await lockingClient.query(
          `
          SELECT id FROM outbox_events
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 5
          FOR UPDATE
          `,
        );

        // Verify we locked 5 rows
        expect(lockedResult.rows).toHaveLength(5);
        const lockedIds = new Set(lockedResult.rows.map((r) => r.id));

        // Now try to claim events with the repository (should skip the locked rows)
        const claimedEvents = await repository.claimPendingEvents(10);

        // Should get exactly 5 events (the ones not locked)
        expect(claimedEvents).toHaveLength(5);

        // None of the claimed events should be in the locked set
        for (const event of claimedEvents) {
          expect(lockedIds.has(event.id)).toBe(false);
        }

        // Clean up: rollback the locking transaction
        await lockingClient.query("ROLLBACK");
      } finally {
        lockingClient.release();
      }
    });
  });

  describe("getPendingEventCount()", () => {
    it("should count pending events", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending'),
          ('Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'pending')
        `,
      );

      const count = await repository.getPendingEventCount();
      expect(count).toBe(2);
    });

    it("should count failed events past their retry time", async () => {
      await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, next_retry_at
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'failed', NOW())
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
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        RETURNING id
        `,
      );
      const eventId = insertResult.rows[0].id;

      // Mark succeeded
      await repository.markSucceeded([{ eventId, workerId: "worker-1" }]);

      // Verify
      const result = await pool.query(
        "SELECT status, processed_by_worker FROM outbox_events WHERE id = $1",
        [eventId],
      );
      expect(result.rows[0].status).toBe("succeeded");
      expect(result.rows[0].processed_by_worker).toBe("worker-1");
    });

    it("should handle empty array", async () => {
      // Should not throw
      await repository.markSucceeded([]);
    });

    it("should mark multiple events with different worker IDs", async () => {
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing'),
          ('Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        RETURNING id
        `,
      );

      const eventId1 = insertResult.rows[0].id;
      const eventId2 = insertResult.rows[1].id;

      await repository.markSucceeded([
        { eventId: eventId1, workerId: "worker-1" },
        { eventId: eventId2, workerId: "worker-2" },
      ]);

      const result = await pool.query(
        "SELECT id, processed_by_worker FROM outbox_events WHERE id IN ($1, $2) ORDER BY id",
        [eventId1, eventId2],
      );

      // Find rows by ID (order may vary based on ID generation)
      const row1 = result.rows.find((row) => row.id === eventId1);
      const row2 = result.rows.find((row) => row.id === eventId2);

      expect(row1).toBeDefined();
      expect(row1!.processed_by_worker).toBe("worker-1");

      expect(row2).toBeDefined();
      expect(row2!.processed_by_worker).toBe("worker-2");
    });
  });

  describe("scheduleRetry()", () => {
    it("should mark event as failed with next retry time", async () => {
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, retry_count, max_retries
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', 0, 5)
        RETURNING id
        `,
      );
      const eventId = insertResult.rows[0].id;

      const errorMessages = new Map([[eventId, "Temporary error"]]);
      await repository.scheduleRetry([eventId], errorMessages, {
        backoffBaseMs: 1000,
        backoffMultiplier: 2,
      });

      const result = await pool.query(
        "SELECT status, retry_count, next_retry_at, last_error FROM outbox_events WHERE id = $1",
        [eventId],
      );

      expect(result.rows[0].status).toBe("failed");
      expect(result.rows[0].retry_count).toBe(1);
      expect(result.rows[0].last_error).toBe("Temporary error");
      expect(result.rows[0].next_retry_at).not.toBeNull();
    });

    it("should not update events when max retries exceeded (must call moveToDLQ explicitly)", async () => {
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status, retry_count, max_retries
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing', 5, 5)
        RETURNING id
        `,
      );
      const eventId = insertResult.rows[0].id;

      const errorMessages = new Map([[eventId, "Final error"]]);
      // scheduleRetry doesn't update events that exceeded max retries
      await repository.scheduleRetry([eventId], errorMessages, {
        backoffBaseMs: 1000,
        backoffMultiplier: 2,
      });

      const result = await pool.query(
        "SELECT status FROM outbox_events WHERE id = $1",
        [eventId],
      );

      // Event stays in 'processing' - must call moveToDLQ explicitly
      expect(result.rows[0].status).toBe("processing");

      // Now explicitly move to DLQ
      await repository.moveToDLQ([eventId], errorMessages);

      const dlqResult = await pool.query(
        "SELECT status, last_error FROM outbox_events WHERE id = $1",
        [eventId],
      );

      expect(dlqResult.rows[0].status).toBe("dlq");
      expect(dlqResult.rows[0].last_error).toBe("Final error");
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
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES
          ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing'),
          ('Order', 'order-2', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        RETURNING id
        `,
      );

      const eventId1 = insertResult.rows[0].id;
      const eventId2 = insertResult.rows[1].id;

      const errorMessages = new Map([
        [eventId1, "Error 1"],
        [eventId2, "Error 2"],
      ]);

      await repository.moveToDLQ([eventId1, eventId2], errorMessages);

      const result = await pool.query(
        "SELECT id, status, last_error FROM outbox_events WHERE id IN ($1, $2) ORDER BY id",
        [eventId1, eventId2],
      );

      // Find rows by ID (order may vary based on ID generation)
      const row1 = result.rows.find((row) => row.id === eventId1);
      const row2 = result.rows.find((row) => row.id === eventId2);

      expect(row1).toBeDefined();
      expect(row1!.status).toBe("dlq");
      expect(row1!.last_error).toBe("Error 1");

      expect(row2).toBeDefined();
      expect(row2!.status).toBe("dlq");
      expect(row2!.last_error).toBe("Error 2");
    });

    it("should handle empty array", async () => {
      await repository.moveToDLQ([], new Map());
    });

    it("should use default error message when not provided", async () => {
      const insertResult = await pool.query(
        `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload,
          destination_url, status
        ) VALUES ('Order', 'order-1', 'OrderCreated', '{"test":true}', 'http://example.com', 'processing')
        RETURNING id
        `,
      );
      const eventId = insertResult.rows[0].id;

      await repository.moveToDLQ([eventId], new Map());

      const result = await pool.query(
        "SELECT last_error FROM outbox_events WHERE id = $1",
        [eventId],
      );

      expect(result.rows[0].last_error).toBe("Unknown error");
    });
  });
});
