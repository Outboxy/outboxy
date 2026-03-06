import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { MySQLMaintenance } from "../repositories/mysql-maintenance.js";
import { makePool, noopLogger, makeLogger } from "./helpers.js";

describe("MySQLMaintenance (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("cleanupProcessedInboxEvents()", () => {
    it("should delete processed inbox events and return count", async () => {
      const pool = makePool([{ affectedRows: 7 } as ResultSetHeader]);
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      const deleted = await maintenance.cleanupProcessedInboxEvents(30);

      expect(deleted).toBe(7);
      expect(pool.execute).toHaveBeenCalledOnce();
    });

    it("should throw for non-integer retentionDays", async () => {
      const pool = makePool();
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await expect(
        maintenance.cleanupProcessedInboxEvents(1.5),
      ).rejects.toThrow("retentionDays must be a positive integer");

      expect(pool.execute).not.toHaveBeenCalled();
    });

    it("should throw for zero retentionDays", async () => {
      const pool = makePool();
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(0)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should throw for negative retentionDays", async () => {
      const pool = makePool();
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(-5)).rejects.toThrow(
        "retentionDays must be a positive integer",
      );
    });

    it("should log info when events are deleted", async () => {
      const pool = makePool([{ affectedRows: 4 } as ResultSetHeader]);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      await maintenance.cleanupProcessedInboxEvents(14);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 4, retentionDays: 14 }),
        "Cleaned up processed inbox events",
      );
    });

    it("should not log when no events are deleted", async () => {
      const pool = makePool([{ affectedRows: 0 } as ResultSetHeader]);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      await maintenance.cleanupProcessedInboxEvents(30);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should use noopLogger when no logger provided", async () => {
      const pool = makePool([{ affectedRows: 2 } as ResultSetHeader]);
      const maintenance = new MySQLMaintenance(pool); // No logger

      const deleted = await maintenance.cleanupProcessedInboxEvents(7);
      expect(deleted).toBe(2);
    });

    it("should propagate database errors", async () => {
      const pool = {
        execute: vi.fn().mockRejectedValue(new Error("database error")),
      } as unknown as Pool;
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await expect(maintenance.cleanupProcessedInboxEvents(30)).rejects.toThrow(
        "database error",
      );
    });
  });

  describe("recoverStaleEvents() (unit)", () => {
    it("should return 0 when no stale events found", async () => {
      const emptyRows: RowDataPacket[] = [];
      const pool = makePool([emptyRows]);
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      const count = await maintenance.recoverStaleEvents(300000);

      expect(count).toBe(0);
      // Should only call execute once (SELECT)
      expect(pool.execute).toHaveBeenCalledTimes(1);
    });

    it("should recover stale events and return count", async () => {
      const staleRows: RowDataPacket[] = [
        {
          id: "00000000-0000-0000-0000-000000000001",
        } as unknown as RowDataPacket,
        {
          id: "00000000-0000-0000-0000-000000000002",
        } as unknown as RowDataPacket,
      ];
      const updateResult = [{ affectedRows: 2 } as ResultSetHeader];
      const pool = makePool([staleRows], updateResult);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      const count = await maintenance.recoverStaleEvents(300000);

      expect(count).toBe(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ recoveredCount: 2, thresholdMs: 300000 }),
        "Recovered stale events",
      );
    });

    it("should convert threshold from ms to seconds", async () => {
      const emptyRows: RowDataPacket[] = [];
      const pool = makePool([emptyRows]);
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await maintenance.recoverStaleEvents(60000); // 60 seconds

      const callArgs = (pool.execute as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      // thresholdSeconds = Math.ceil(60000 / 1000) = 60
      expect(callArgs[1]).toContain(60);
    });

    it("should throw for invalid UUID in event IDs", async () => {
      const invalidRows: RowDataPacket[] = [
        { id: "not-a-valid-uuid" } as unknown as RowDataPacket,
      ];
      const pool = makePool([invalidRows]);
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      await expect(maintenance.recoverStaleEvents(300000)).rejects.toThrow(
        "Invalid event ID format",
      );
    });

    it("should not log when no events are recovered", async () => {
      const emptyRows: RowDataPacket[] = [];
      const pool = makePool([emptyRows]);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      await maintenance.recoverStaleEvents(300000);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("cleanupStaleIdempotencyKeys() (unit)", () => {
    it("should return count of cleared keys", async () => {
      const pool = makePool([{ affectedRows: 5 } as ResultSetHeader]);
      const maintenance = new MySQLMaintenance(pool, noopLogger);

      const count = await maintenance.cleanupStaleIdempotencyKeys(30);

      expect(count).toBe(5);
      expect(pool.execute).toHaveBeenCalledOnce();
    });

    it("should log info when keys are cleared", async () => {
      const pool = makePool([{ affectedRows: 3 } as ResultSetHeader]);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      await maintenance.cleanupStaleIdempotencyKeys(30);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ clearedCount: 3, retentionDays: 30 }),
        "Cleared stale idempotency keys",
      );
    });

    it("should not log when no keys are cleared", async () => {
      const pool = makePool([{ affectedRows: 0 } as ResultSetHeader]);
      const logger = makeLogger();
      const maintenance = new MySQLMaintenance(pool, logger);

      await maintenance.cleanupStaleIdempotencyKeys(30);

      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
