import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import { PgInboxRepository } from "../repositories/pg-inbox.repository.js";
import { makePool } from "./helpers.js";

const baseEvent = {
  idempotencyKey: "key-123",
  source: "order-service",
  aggregateType: "Order",
  aggregateId: "order-1",
  eventType: "OrderCreated",
  eventVersion: 1,
  payload: { amount: 100 },
  headers: { "x-trace": "trace-1" },
  metadata: { region: "us-east" },
};

describe("PgInboxRepository", () => {
  let repo: PgInboxRepository;

  beforeEach(() => {
    repo = new PgInboxRepository();
  });

  describe("receive()", () => {
    it("should return processed status when event is new", async () => {
      const pool = makePool({ rows: [{ id: "event-uuid-1" }], rowCount: 1 });

      const result = await repo.receive(baseEvent, pool);

      expect(result.status).toBe("processed");
      expect(result.eventId).toBe("event-uuid-1");
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it("should return duplicate status when ON CONFLICT DO NOTHING fires", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });

      const result = await repo.receive(baseEvent, pool);

      expect(result.status).toBe("duplicate");
      expect(result.eventId).toBeNull();
    });

    it("should use null for missing source", async () => {
      const pool = makePool({ rows: [{ id: "event-uuid-2" }], rowCount: 1 });
      const event = { ...baseEvent, source: undefined };

      await repo.receive(event, pool);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as unknown[];
      expect(params[1]).toBeNull();
    });

    it("should default eventVersion to 1 when not provided", async () => {
      const pool = makePool({ rows: [{ id: "event-uuid-3" }], rowCount: 1 });
      const event = { ...baseEvent, eventVersion: undefined };

      await repo.receive(event as any, pool);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as unknown[];
      expect(params[5]).toBe(1);
    });

    it("should use empty objects for missing headers and metadata", async () => {
      const pool = makePool({ rows: [{ id: "event-uuid-4" }], rowCount: 1 });
      const event = { ...baseEvent, headers: undefined, metadata: undefined };

      await repo.receive(event as any, pool);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const params = callArgs[1] as unknown[];
      expect(params[7]).toBe(JSON.stringify({}));
      expect(params[8]).toBe(JSON.stringify({}));
    });

    it("should propagate database errors", async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error("db error")),
      } as unknown as Pool;

      await expect(repo.receive(baseEvent, pool)).rejects.toThrow("db error");
    });
  });

  describe("receiveBatch()", () => {
    it("should return empty array for empty input", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });

      const results = await repo.receiveBatch([], pool);

      expect(results).toEqual([]);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("should return processed for newly inserted events", async () => {
      const insertedId = "uuid-new-1";
      const pool = {
        query: vi
          .fn()
          // First call: INSERT ... RETURNING id
          .mockResolvedValueOnce({ rows: [{ id: insertedId }], rowCount: 1 })
          // Second call: SELECT id, idempotency_key WHERE idempotency_key = ANY(...)
          .mockResolvedValueOnce({
            rows: [{ id: insertedId, idempotency_key: "key-123" }],
            rowCount: 1,
          }),
      } as unknown as Pool;

      const results = await repo.receiveBatch([baseEvent], pool);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("processed");
      expect(results[0]!.eventId).toBe(insertedId);
    });

    it("should return duplicate for pre-existing events", async () => {
      const existingId = "uuid-existing-1";
      const pool = {
        query: vi
          .fn()
          // INSERT returns nothing (conflict)
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          // SELECT returns existing row
          .mockResolvedValueOnce({
            rows: [{ id: existingId, idempotency_key: "key-123" }],
            rowCount: 1,
          }),
      } as unknown as Pool;

      const results = await repo.receiveBatch([baseEvent], pool);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("duplicate");
      expect(results[0]!.eventId).toBe(existingId);
    });

    it("should handle mixed batch of new and duplicate events", async () => {
      const newId = "uuid-new-1";
      const dupId = "uuid-existing-2";
      const events = [
        { ...baseEvent, idempotencyKey: "key-new" },
        { ...baseEvent, idempotencyKey: "key-dup" },
      ];

      const pool = {
        query: vi
          .fn()
          // INSERT returns only the new one
          .mockResolvedValueOnce({ rows: [{ id: newId }], rowCount: 1 })
          // SELECT returns both
          .mockResolvedValueOnce({
            rows: [
              { id: newId, idempotency_key: "key-new" },
              { id: dupId, idempotency_key: "key-dup" },
            ],
            rowCount: 2,
          }),
      } as unknown as Pool;

      const results = await repo.receiveBatch(events, pool);

      expect(results).toHaveLength(2);
      const newResult = results.find((r) => r.eventId === newId);
      const dupResult = results.find((r) => r.eventId === dupId);
      expect(newResult?.status).toBe("processed");
      expect(dupResult?.status).toBe("duplicate");
    });

    it("should throw when event not found after insert", async () => {
      const pool = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          // SELECT returns nothing (unexpected)
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      } as unknown as Pool;

      await expect(repo.receiveBatch([baseEvent], pool)).rejects.toThrow(
        "not found after INSERT ON CONFLICT DO NOTHING",
      );
    });

    it("should build multi-value INSERT for batch", async () => {
      const event1 = { ...baseEvent, idempotencyKey: "key-1" };
      const event2 = { ...baseEvent, idempotencyKey: "key-2" };

      const pool = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [{ id: "id-1" }, { id: "id-2" }],
            rowCount: 2,
          })
          .mockResolvedValueOnce({
            rows: [
              { id: "id-1", idempotency_key: "key-1" },
              { id: "id-2", idempotency_key: "key-2" },
            ],
            rowCount: 2,
          }),
      } as unknown as Pool;

      const results = await repo.receiveBatch([event1, event2], pool);

      expect(results).toHaveLength(2);
      const insertCall = (pool.query as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(insertCall[0]).toContain(
        "ON CONFLICT (idempotency_key) DO NOTHING",
      );
      expect(insertCall[1]).toHaveLength(20); // 10 params per event * 2
    });
  });

  describe("markFailed()", () => {
    it("should update event status to failed", async () => {
      const pool = makePool({ rows: [], rowCount: 1 });

      await repo.markFailed("event-uuid-1", "business logic error", pool);

      expect(pool.query).toHaveBeenCalledOnce();
      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[1]).toContain("event-uuid-1");
      expect(callArgs[1]).toContain("failed");
    });

    it("should truncate error messages exceeding max length", async () => {
      const pool = makePool({ rows: [], rowCount: 1 });
      const longError = "x".repeat(10000);

      await repo.markFailed("event-uuid-1", longError, pool);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const errorParam = callArgs[1][2] as string;
      expect(errorParam.length).toBeLessThan(10000);
    });

    it("should propagate database errors", async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error("connection lost")),
      } as unknown as Pool;

      await expect(
        repo.markFailed("event-uuid-1", "error", pool),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("cleanupProcessedEvents()", () => {
    it("should delete old processed events and return count", async () => {
      const pool = makePool({ rows: [], rowCount: 5 });

      const deleted = await repo.cleanupProcessedEvents(30, pool);

      expect(deleted).toBe(5);
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it("should return 0 when rowCount is null", async () => {
      const pool = makePool({ rows: [], rowCount: null });

      const deleted = await repo.cleanupProcessedEvents(30, pool);

      expect(deleted).toBe(0);
    });

    it("should throw for non-integer retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });

      await expect(repo.cleanupProcessedEvents(1.5, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for zero retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });

      await expect(repo.cleanupProcessedEvents(0, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for negative retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });

      await expect(repo.cleanupProcessedEvents(-1, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should pass retentionDays as parameter to query", async () => {
      const pool = makePool({ rows: [], rowCount: 3 });

      await repo.cleanupProcessedEvents(7, pool);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[1]).toContain(7);
    });
  });
});
