import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { MySqlInboxRepository } from "../repositories/mysql-inbox.repository.js";
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

describe("MySqlInboxRepository", () => {
  let repo: MySqlInboxRepository;

  beforeEach(() => {
    repo = new MySqlInboxRepository();
    vi.clearAllMocks();
  });

  describe("receive()", () => {
    it("should return processed status when event is newly inserted", async () => {
      const mockResult = [{ affectedRows: 1 } as ResultSetHeader];
      const pool = makePool(mockResult);

      const result = await repo.receive(baseEvent, pool);

      expect(result.status).toBe("processed");
      expect(result.eventId).toBeDefined();
      expect(typeof result.eventId).toBe("string");
    });

    it("should return duplicate status when INSERT IGNORE fires (affectedRows=0)", async () => {
      const mockResult = [{ affectedRows: 0 } as ResultSetHeader];
      const pool = makePool(mockResult);

      const result = await repo.receive(baseEvent, pool);

      expect(result.status).toBe("duplicate");
      expect(result.eventId).toBeNull();
    });

    it("should use null for missing source", async () => {
      const mockResult = [{ affectedRows: 1 } as ResultSetHeader];
      const pool = makePool(mockResult);
      const event = { ...baseEvent, source: undefined };

      await repo.receive(event, pool);

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      const params = callArgs[1] as unknown[];
      // generatedId is first, idempotency_key second, source third
      expect(params[2]).toBeNull();
    });

    it("should default eventVersion to 1 when not provided", async () => {
      const mockResult = [{ affectedRows: 1 } as ResultSetHeader];
      const pool = makePool(mockResult);
      const event = { ...baseEvent, eventVersion: undefined };

      await repo.receive(event as any, pool);

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      const params = callArgs[1] as unknown[];
      // params: [id, idempotencyKey, source, aggregateType, aggregateId, eventType, eventVersion, ...]
      expect(params[6]).toBe(1);
    });

    it("should use empty objects for missing headers and metadata", async () => {
      const mockResult = [{ affectedRows: 1 } as ResultSetHeader];
      const pool = makePool(mockResult);
      const event = { ...baseEvent, headers: undefined, metadata: undefined };

      await repo.receive(event as any, pool);

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      const params = callArgs[1] as unknown[];
      expect(params[8]).toBe(JSON.stringify({}));
      expect(params[9]).toBe(JSON.stringify({}));
    });

    it("should propagate database errors", async () => {
      const pool = {
        execute: vi.fn().mockRejectedValue(new Error("db error")),
      } as unknown as Pool;

      await expect(repo.receive(baseEvent, pool)).rejects.toThrow("db error");
    });
  });

  describe("receiveBatch()", () => {
    it("should return empty array for empty input", async () => {
      const pool = makePool();

      const results = await repo.receiveBatch([], pool);

      expect(results).toEqual([]);
      expect(pool.execute).not.toHaveBeenCalled();
    });

    it("should return processed for newly inserted events", async () => {
      const generatedId = "00000000-0000-0000-0000-000000000001";
      vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(generatedId);

      const insertResult = [{ affectedRows: 1 } as ResultSetHeader];
      const existingRows: RowDataPacket[] = [
        {
          id: generatedId,
          idempotency_key: "key-123",
        } as unknown as RowDataPacket,
      ];
      const pool = makePool(insertResult, [existingRows]);

      const results = await repo.receiveBatch([baseEvent], pool);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("processed");
      expect(results[0]!.eventId).toBe(generatedId);
    });

    it("should return duplicate when idempotency key already exists", async () => {
      const existingId = "pre-existing-uuid";
      vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
        "00000000-0000-0000-0000-000000000001",
      );

      const insertResult = [{ affectedRows: 0 } as ResultSetHeader];
      const existingRows: RowDataPacket[] = [
        {
          id: existingId,
          idempotency_key: "key-123",
        } as unknown as RowDataPacket,
      ];
      const pool = makePool(insertResult, [existingRows]);

      const results = await repo.receiveBatch([baseEvent], pool);

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("duplicate");
      expect(results[0]!.eventId).toBe(existingId);
    });

    it("should throw when event not found after INSERT IGNORE", async () => {
      const insertResult = [{ affectedRows: 0 } as ResultSetHeader];
      const emptyRows: RowDataPacket[] = [];
      const pool = makePool(insertResult, [emptyRows]);

      await expect(repo.receiveBatch([baseEvent], pool)).rejects.toThrow(
        "not found after INSERT IGNORE",
      );
    });

    it("should handle batch of multiple events", async () => {
      const event1 = { ...baseEvent, idempotencyKey: "key-1" };
      const event2 = { ...baseEvent, idempotencyKey: "key-2" };

      const insertResult = [{ affectedRows: 2 } as ResultSetHeader];
      const existingRows: RowDataPacket[] = [
        { id: "uuid-1", idempotency_key: "key-1" } as unknown as RowDataPacket,
        { id: "uuid-2", idempotency_key: "key-2" } as unknown as RowDataPacket,
      ];
      const pool = makePool(insertResult, [existingRows]);

      const results = await repo.receiveBatch([event1, event2], pool);

      expect(results).toHaveLength(2);
    });
  });

  describe("markFailed()", () => {
    it("should update event status to failed", async () => {
      const pool = makePool([{ affectedRows: 1 } as ResultSetHeader]);

      await repo.markFailed("event-uuid-1", "business logic error", pool);

      expect(pool.execute).toHaveBeenCalledOnce();
      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(callArgs[1]).toContain("failed");
      expect(callArgs[1]).toContain("event-uuid-1");
    });

    it("should truncate error messages exceeding max length", async () => {
      const pool = makePool([{ affectedRows: 1 } as ResultSetHeader]);
      const longError = "x".repeat(10000);

      await repo.markFailed("event-uuid-1", longError, pool);

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      const errorParam = callArgs[1][1] as string;
      expect(errorParam.length).toBeLessThan(10000);
    });

    it("should propagate database errors", async () => {
      const pool = {
        execute: vi.fn().mockRejectedValue(new Error("connection lost")),
      } as unknown as Pool;

      await expect(
        repo.markFailed("event-uuid-1", "error", pool),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("cleanupProcessedEvents()", () => {
    it("should delete old processed events and return count", async () => {
      const pool = makePool([{ affectedRows: 5 } as ResultSetHeader]);

      const deleted = await repo.cleanupProcessedEvents(30, pool);

      expect(deleted).toBe(5);
      expect(pool.execute).toHaveBeenCalledOnce();
    });

    it("should throw for non-integer retentionDays", async () => {
      const pool = makePool();

      await expect(repo.cleanupProcessedEvents(1.5, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for zero retentionDays", async () => {
      const pool = makePool();

      await expect(repo.cleanupProcessedEvents(0, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for negative retentionDays", async () => {
      const pool = makePool();

      await expect(repo.cleanupProcessedEvents(-1, pool)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should pass retentionDays as parameter to query", async () => {
      const pool = makePool([{ affectedRows: 3 } as ResultSetHeader]);

      await repo.cleanupProcessedEvents(7, pool);

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(callArgs[1]).toContain(7);
    });
  });
});
