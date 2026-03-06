/**
 * PgEventService Integration Tests
 *
 * Tests the API-side service operations:
 * - createEvent: Create new outbox events
 * - getEventById: Get single event (respects soft deletes)
 * - findByIdempotencyKey: Idempotency key lookup
 * - replayEvent: Replay single failed/DLQ event
 * - replayEventsInRange: Batch replay with filters
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  truncateAllTables,
} from "@outboxy/testing-utils";
import type { Pool } from "pg";
import { PgEventService } from "../repositories/pg-event.service.js";

describe("PgEventService", () => {
  let pool: Pool;
  let service: PgEventService;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await createIsolatedTestPool({ name: "pg-event-service" });
    pool = result.pool;
    cleanup = result.cleanup;
    service = new PgEventService(pool);
  }, 10000);

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe("createEvent()", () => {
    it("should create a new event", async () => {
      const result = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: { orderId: "order-123", amount: 100 },
        destinationUrl: "http://example.com/webhook",
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("pending");
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("should create event with all optional fields", async () => {
      const result = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-456",
        eventType: "OrderUpdated",
        payload: { amount: 200 },
        destinationUrl: "http://example.com/webhook",
        eventVersion: 2,
        destinationType: "kafka",
        idempotencyKey: "unique-key-123",
        maxRetries: 10,
        headers: { "X-Custom": "value" },
        metadata: { traceId: "trace-123" },
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe("pending");
    });

    it("should use default values for optional fields", async () => {
      const result = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-789",
        eventType: "OrderCancelled",
        payload: {},
        destinationUrl: "http://example.com/webhook",
      });

      expect(result.status).toBe("pending");

      // Verify defaults in database
      const row = await pool.query(
        "SELECT event_version, destination_type, max_retries, headers, metadata FROM outbox_events WHERE id = $1",
        [result.id],
      );

      expect(row.rows[0].event_version).toBe(1);
      expect(row.rows[0].destination_type).toBe("http");
      expect(row.rows[0].max_retries).toBe(5);
      expect(row.rows[0].headers).toEqual({});
      expect(row.rows[0].metadata).toEqual({});
    });
  });

  describe("getEventById()", () => {
    it("should get event by id", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: { test: true },
        destinationUrl: "http://example.com/webhook",
      });

      const event = await service.getEventById(created.id);

      expect(event).not.toBeNull();
      expect(event?.id).toBe(created.id);
      expect(event?.aggregateType).toBe("Order");
      expect(event?.status).toBe("pending");
    });

    it("should return null for non-existent event", async () => {
      const event = await service.getEventById(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(event).toBeNull();
    });

    it("should return null for soft-deleted events", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
      });

      // Soft delete the event
      await pool.query(
        "UPDATE outbox_events SET deleted_at = NOW() WHERE id = $1",
        [created.id],
      );

      const event = await service.getEventById(created.id);
      expect(event).toBeNull();
    });
  });

  describe("findByIdempotencyKey()", () => {
    it("should find event by idempotency key", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
        idempotencyKey: "unique-key-abc",
      });

      const result = await service.findByIdempotencyKey("unique-key-abc");

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.status).toBe("pending");
    });

    it("should not find succeeded events (they can be replayed)", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
        idempotencyKey: "unique-key-def",
      });

      // Mark as succeeded
      await pool.query(
        "UPDATE outbox_events SET status = 'succeeded' WHERE id = $1",
        [created.id],
      );

      const result = await service.findByIdempotencyKey("unique-key-def");
      expect(result).toBeNull();
    });

    it("should find pending/processing/failed events", async () => {
      const statuses = ["pending", "processing", "failed"];

      for (const status of statuses) {
        await service.createEvent({
          aggregateType: "Order",
          aggregateId: `order-${status}`,
          eventType: "OrderCreated",
          payload: {},
          destinationUrl: "http://example.com/webhook",
          idempotencyKey: `key-${status}`,
        });

        await pool.query(
          "UPDATE outbox_events SET status = $1 WHERE idempotency_key = $2",
          [status, `key-${status}`],
        );

        const result = await service.findByIdempotencyKey(`key-${status}`);
        expect(result).not.toBeNull();
        expect(result?.status).toBe(status);
      }
    });

    it("should return null for non-existent key", async () => {
      const result = await service.findByIdempotencyKey("non-existent-key");
      expect(result).toBeNull();
    });
  });

  describe("replayEvent()", () => {
    it("should replay a failed event", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
      });

      // Mark as failed
      await pool.query(
        "UPDATE outbox_events SET status = 'failed' WHERE id = $1",
        [created.id],
      );

      const result = await service.replayEvent(created.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.previousStatus).toBe("failed");
      expect(result?.newStatus).toBe("pending");
      expect(result?.replayedAt).toBeInstanceOf(Date);
    });

    it("should replay a DLQ event", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-456",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
      });

      // Mark as DLQ
      await pool.query(
        "UPDATE outbox_events SET status = 'dlq' WHERE id = $1",
        [created.id],
      );

      const result = await service.replayEvent(created.id);

      expect(result).not.toBeNull();
      expect(result?.previousStatus).toBe("dlq");
      expect(result?.newStatus).toBe("pending");
    });

    it("should not replay pending/processing/succeeded events", async () => {
      const statuses: Array<"pending" | "processing" | "succeeded"> = [
        "pending",
        "processing",
        "succeeded",
      ];

      for (const status of statuses) {
        const created = await service.createEvent({
          aggregateType: "Order",
          aggregateId: `order-${status}`,
          eventType: "OrderCreated",
          payload: {},
          destinationUrl: "http://example.com/webhook",
        });

        await pool.query("UPDATE outbox_events SET status = $1 WHERE id = $2", [
          status,
          created.id,
        ]);

        const result = await service.replayEvent(created.id);
        expect(result).toBeNull();
      }
    });

    it("should return null for non-existent event", async () => {
      const result = await service.replayEvent(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeNull();
    });

    it("should reset retry fields when replaying", async () => {
      const created = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-789",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com/webhook",
      });

      // Mark as failed with retry info
      await pool.query(
        `
        UPDATE outbox_events
        SET status = 'failed',
            retry_count = 5,
            next_retry_at = NOW() + INTERVAL '1 hour',
            last_error = 'Test error'
        WHERE id = $1
        `,
        [created.id],
      );

      await service.replayEvent(created.id);

      const row = await pool.query(
        "SELECT retry_count, next_retry_at, last_error FROM outbox_events WHERE id = $1",
        [created.id],
      );

      expect(row.rows[0].retry_count).toBe(0);
      expect(row.rows[0].next_retry_at).toBeNull();
      expect(row.rows[0].last_error).toBeNull();
    });
  });

  describe("replayEventsInRange()", () => {
    it("should replay events in date range", async () => {
      // Create events using service (goes to isolated schema via search_path)
      const event1 = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-1",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });
      const event2 = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-2",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });

      // Update status to dlq using direct SQL (uses search_path to find isolated schema)
      await pool.query(
        `UPDATE outbox_events SET status = 'dlq' WHERE id = ANY($1)`,
        [[event1.id, event2.id]],
      );

      // Use a wide date range to ensure we find the events
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
      });

      expect(result.replayedCount).toBe(2);
      expect(result.eventIds).toHaveLength(2);
    });

    it("should filter by aggregate type", async () => {
      const event1 = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-1",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });
      await service.createEvent({
        aggregateType: "Payment",
        aggregateId: "payment-1",
        eventType: "PaymentCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });

      // Update only Order event to dlq
      await pool.query(
        `UPDATE outbox_events SET status = 'dlq' WHERE id = $1`,
        [event1.id],
      );

      // Use a wide date range to ensure we find the events
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
        aggregateType: "Order",
      });

      expect(result.replayedCount).toBe(1);
      expect(result.eventIds[0]).toBe(event1.id);
    });

    it("should respect limit parameter", async () => {
      const eventIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        const event = await service.createEvent({
          aggregateType: "Order",
          aggregateId: `order-${i}`,
          eventType: "OrderCreated",
          payload: {},
          destinationUrl: "http://example.com",
        });
        eventIds.push(event.id);
      }

      // Update all to dlq
      await pool.query(
        `UPDATE outbox_events SET status = 'dlq' WHERE id = ANY($1)`,
        [eventIds],
      );

      // Use a wide date range to ensure we find the events
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
        limit: 3,
      });

      expect(result.replayedCount).toBe(3);
    });

    it("should return empty result when no events match", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
      });

      expect(result.replayedCount).toBe(0);
      expect(result.eventIds).toHaveLength(0);
    });

    it("should filter by status (default is dlq)", async () => {
      const event1 = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-1",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });
      const event2 = await service.createEvent({
        aggregateType: "Order",
        aggregateId: "order-2",
        eventType: "OrderCreated",
        payload: {},
        destinationUrl: "http://example.com",
      });

      // Update one to failed, one to dlq
      await pool.query(
        `UPDATE outbox_events SET status = 'failed' WHERE id = $1`,
        [event1.id],
      );
      await pool.query(
        `UPDATE outbox_events SET status = 'dlq' WHERE id = $1`,
        [event2.id],
      );

      // Use a wide date range to ensure we find the events
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Default should only replay dlq
      const result1 = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
      });

      expect(result1.replayedCount).toBe(1);

      // Explicitly replay failed events
      const result2 = await service.replayEventsInRange({
        startDate: yesterday,
        endDate: tomorrow,
        status: "failed",
      });

      expect(result2.replayedCount).toBe(1);
    });
  });
});
