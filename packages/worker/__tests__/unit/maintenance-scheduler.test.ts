import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMaintenanceScheduler,
  type MaintenanceSchedulerConfig,
} from "../../src/maintenance-scheduler.js";
import type { Logger } from "@outboxy/logging";
import type { MaintenanceOperations } from "@outboxy/db-adapter-core";
import { makeLogger, makeMetrics } from "./helpers.js";

function makeMaintenance(): MaintenanceOperations {
  return {
    recoverStaleEvents: vi.fn(async () => 0),
    cleanupStaleIdempotencyKeys: vi.fn(async () => 0),
    cleanupProcessedInboxEvents: vi.fn(async () => 0),
  } as unknown as MaintenanceOperations;
}

function makeConfig(
  overrides: Partial<MaintenanceSchedulerConfig> = {},
): MaintenanceSchedulerConfig {
  return {
    staleRecoveryIntervalMs: 1000,
    staleEventThresholdMs: 300000,
    idempotencyCleanupEnabled: true,
    idempotencyCleanupIntervalMs: 1000,
    idempotencyRetentionDays: 30,
    inboxCleanupEnabled: false,
    inboxCleanupIntervalMs: 1000,
    inboxRetentionDays: 30,
    ...overrides,
  };
}

describe("createMaintenanceScheduler", () => {
  let mockLogger: Logger;
  let mockMaintenance: MaintenanceOperations;

  beforeEach(() => {
    mockLogger = makeLogger();
    mockMaintenance = makeMaintenance();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("start/stop lifecycle", () => {
    it("starts without errors", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig(),
        mockLogger,
      );
      expect(() => scheduler.start()).not.toThrow();
      scheduler.stop();
    });

    it("stops without errors when started", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig(),
        mockLogger,
      );
      scheduler.start();
      expect(() => scheduler.stop()).not.toThrow();
    });

    it("logs stale recovery start message", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig(),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          intervalMs: 1000,
          thresholdMs: 300000,
        }),
        "Starting stale event recovery scheduler",
      );
    });

    it("logs stale recovery stop message", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig(),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stopping stale event recovery scheduler",
      );
    });
  });

  describe("stale event recovery", () => {
    it("calls recoverStaleEvents on interval", async () => {
      vi.mocked(mockMaintenance.recoverStaleEvents).mockResolvedValue(5);

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 500 }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(600);
      scheduler.stop();

      expect(mockMaintenance.recoverStaleEvents).toHaveBeenCalled();
    });

    it("logs recovered stale events when count > 0", async () => {
      vi.mocked(mockMaintenance.recoverStaleEvents).mockResolvedValue(3);

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 100 }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ recoveredCount: 3 }),
        "Recovered stale events",
      );
    });

    it("does not log when 0 events recovered", async () => {
      vi.mocked(mockMaintenance.recoverStaleEvents).mockResolvedValue(0);

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 100 }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        "Recovered stale events",
      );
    });

    it("logs error when recoverStaleEvents throws", async () => {
      vi.mocked(mockMaintenance.recoverStaleEvents).mockRejectedValue(
        new Error("DB error"),
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 100 }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Stale event recovery failed",
      );
    });

    it("records staleEventsRecovered metric when count > 0", async () => {
      const metrics = makeMetrics();

      vi.mocked(mockMaintenance.recoverStaleEvents).mockResolvedValue(7);

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 100 }),
        mockLogger,
        metrics,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(metrics.staleEventsRecovered.inc).toHaveBeenCalledWith(7);
    });

    it("skips execution when already running (re-entrancy guard)", async () => {
      let resolveFirst: () => void;
      const hangingPromise = new Promise<number>((resolve) => {
        resolveFirst = () => resolve(1);
      });

      vi.mocked(mockMaintenance.recoverStaleEvents)
        .mockReturnValueOnce(hangingPromise)
        .mockResolvedValue(0);

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ staleRecoveryIntervalMs: 100 }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(100);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Stale recovery already running, skipping this iteration",
      );

      resolveFirst!();
      await vi.advanceTimersByTimeAsync(10);
      scheduler.stop();
    });
  });

  describe("idempotency cleanup", () => {
    it("logs idempotency cleanup start when enabled", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ idempotencyCleanupEnabled: true }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          intervalMs: expect.any(Number),
          retentionDays: 30,
        }),
        "Starting idempotency cleanup scheduler",
      );
    });

    it("logs debug message when idempotency cleanup is disabled", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ idempotencyCleanupEnabled: false }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Idempotency cleanup is disabled",
      );
    });

    it("calls cleanupStaleIdempotencyKeys on interval", async () => {
      vi.mocked(mockMaintenance.cleanupStaleIdempotencyKeys).mockResolvedValue(
        5,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          idempotencyCleanupEnabled: true,
          idempotencyCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockMaintenance.cleanupStaleIdempotencyKeys).toHaveBeenCalled();
    });

    it("logs cleared idempotency keys when count > 0", async () => {
      vi.mocked(mockMaintenance.cleanupStaleIdempotencyKeys).mockResolvedValue(
        10,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          idempotencyCleanupEnabled: true,
          idempotencyCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ clearedCount: 10 }),
        "Cleared stale idempotency keys",
      );
    });

    it("logs error when cleanupStaleIdempotencyKeys throws", async () => {
      vi.mocked(mockMaintenance.cleanupStaleIdempotencyKeys).mockRejectedValue(
        new Error("Cleanup failed"),
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          idempotencyCleanupEnabled: true,
          idempotencyCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Idempotency cleanup failed",
      );
    });

    it("stops idempotency cleanup timer on stop()", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ idempotencyCleanupEnabled: true }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stopping idempotency cleanup scheduler",
      );
    });

    it("records idempotency metric when count > 0", async () => {
      const metrics = makeMetrics();

      vi.mocked(mockMaintenance.cleanupStaleIdempotencyKeys).mockResolvedValue(
        15,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          idempotencyCleanupEnabled: true,
          idempotencyCleanupIntervalMs: 100,
        }),
        mockLogger,
        metrics,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(metrics.idempotencyKeysCleaned.inc).toHaveBeenCalledWith(15);
    });
  });

  describe("inbox cleanup", () => {
    it("logs debug when inbox cleanup is disabled", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ inboxCleanupEnabled: false }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Inbox cleanup is disabled",
      );
    });

    it("logs inbox cleanup start when enabled and adapter supports it", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ inboxCleanupEnabled: true }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          intervalMs: expect.any(Number),
          retentionDays: 30,
        }),
        "Starting inbox cleanup scheduler",
      );
    });

    it("warns when adapter does not implement cleanupProcessedInboxEvents", () => {
      const maintenanceWithoutInbox = {
        recoverStaleEvents: vi.fn(async () => 0),
        cleanupStaleIdempotencyKeys: vi.fn(async () => 0),
        // No cleanupProcessedInboxEvents
      } as unknown as MaintenanceOperations;

      const scheduler = createMaintenanceScheduler(
        maintenanceWithoutInbox,
        makeConfig({ inboxCleanupEnabled: true }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Inbox cleanup enabled but adapter does not implement cleanupProcessedInboxEvents",
      );
    });

    it("calls cleanupProcessedInboxEvents on interval", async () => {
      vi.mocked(mockMaintenance.cleanupProcessedInboxEvents!).mockResolvedValue(
        3,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          inboxCleanupEnabled: true,
          inboxCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockMaintenance.cleanupProcessedInboxEvents).toHaveBeenCalled();
    });

    it("logs cleaned inbox events when count > 0", async () => {
      vi.mocked(mockMaintenance.cleanupProcessedInboxEvents!).mockResolvedValue(
        8,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          inboxCleanupEnabled: true,
          inboxCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 8 }),
        "Cleaned up processed inbox events",
      );
    });

    it("logs error when cleanupProcessedInboxEvents throws", async () => {
      vi.mocked(mockMaintenance.cleanupProcessedInboxEvents!).mockRejectedValue(
        new Error("Inbox cleanup error"),
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          inboxCleanupEnabled: true,
          inboxCleanupIntervalMs: 100,
        }),
        mockLogger,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Inbox cleanup failed",
      );
    });

    it("stops inbox cleanup timer on stop()", () => {
      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({ inboxCleanupEnabled: true }),
        mockLogger,
      );
      scheduler.start();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Stopping inbox cleanup scheduler",
      );
    });

    it("records inbox metric when count > 0", async () => {
      const metrics = makeMetrics();

      vi.mocked(mockMaintenance.cleanupProcessedInboxEvents!).mockResolvedValue(
        4,
      );

      const scheduler = createMaintenanceScheduler(
        mockMaintenance,
        makeConfig({
          inboxCleanupEnabled: true,
          inboxCleanupIntervalMs: 100,
        }),
        mockLogger,
        metrics,
      );
      scheduler.start();

      await vi.advanceTimersByTimeAsync(200);
      scheduler.stop();

      expect(metrics.inboxEventsCleaned.inc).toHaveBeenCalledWith(4);
    });
  });
});
