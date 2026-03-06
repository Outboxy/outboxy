import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";
import { PgMaintenance } from "../repositories/pg-maintenance.js";
import { makePool, noopLogger, makeLogger } from "./helpers.js";

describe("PgMaintenance (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cleanupProcessedInboxEvents()", () => {
    it("should delete processed inbox events and return count", async () => {
      const pool = makePool({ rows: [], rowCount: 7 });
      const maintenance = new PgMaintenance(pool, noopLogger);

      const deleted = await maintenance.cleanupProcessedInboxEvents(30);

      expect(deleted).toBe(7);
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it("should return 0 when rowCount is null", async () => {
      const pool = makePool({ rows: [], rowCount: null });
      const maintenance = new PgMaintenance(pool, noopLogger);

      const deleted = await maintenance.cleanupProcessedInboxEvents(30);

      expect(deleted).toBe(0);
    });

    it("should throw for non-integer retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const maintenance = new PgMaintenance(pool, noopLogger);

      await expect(
        maintenance.cleanupProcessedInboxEvents(1.5),
      ).rejects.toThrow("retentionDays must be a positive integer");

      expect(pool.query).not.toHaveBeenCalled();
    });

    it("should throw for zero retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const maintenance = new PgMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(0)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for negative retentionDays", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const maintenance = new PgMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(-5)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should log info when events are deleted", async () => {
      const pool = makePool({ rows: [], rowCount: 3 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      await maintenance.cleanupProcessedInboxEvents(14);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 3, retentionDays: 14 }),
        "Cleaned up processed inbox events",
      );
    });

    it("should not log when no events are deleted", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      await maintenance.cleanupProcessedInboxEvents(30);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should use noopLogger when no logger provided", async () => {
      const pool = makePool({ rows: [], rowCount: 2 });
      const maintenance = new PgMaintenance(pool); // No logger

      const deleted = await maintenance.cleanupProcessedInboxEvents(7);
      expect(deleted).toBe(2);
    });

    it("should pass retentionDays as query parameter", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const maintenance = new PgMaintenance(pool, noopLogger);

      await maintenance.cleanupProcessedInboxEvents(90);

      const callArgs = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[1]).toContain(90);
    });

    it("should propagate database errors", async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error("database error")),
      } as unknown as Pool;
      const maintenance = new PgMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(30)).rejects.toThrow(
        "database error",
      );
    });
  });

  describe("recoverStaleEvents() (unit)", () => {
    it("should log warn when events are recovered", async () => {
      const pool = makePool({ rows: [{ id: "evt-1" }], rowCount: 1 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      const count = await maintenance.recoverStaleEvents(300000);

      expect(count).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ recoveredCount: 1, thresholdMs: 300000 }),
        "Recovered stale events",
      );
    });

    it("should not log when no events are recovered", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      const count = await maintenance.recoverStaleEvents(300000);

      expect(count).toBe(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should handle null rowCount", async () => {
      const pool = makePool({ rows: [], rowCount: null });
      const maintenance = new PgMaintenance(pool, noopLogger);

      const count = await maintenance.recoverStaleEvents(300000);

      expect(count).toBe(0);
    });
  });

  describe("cleanupStaleIdempotencyKeys() (unit)", () => {
    it("should log info when keys are cleared", async () => {
      const pool = makePool({ rows: [], rowCount: 5 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      const count = await maintenance.cleanupStaleIdempotencyKeys(30);

      expect(count).toBe(5);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ clearedCount: 5, retentionDays: 30 }),
        "Cleared stale idempotency keys",
      );
    });

    it("should not log when no keys are cleared", async () => {
      const pool = makePool({ rows: [], rowCount: 0 });
      const logger = makeLogger();
      const maintenance = new PgMaintenance(pool, logger);

      const count = await maintenance.cleanupStaleIdempotencyKeys(30);

      expect(count).toBe(0);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
