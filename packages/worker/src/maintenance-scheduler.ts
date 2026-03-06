import type { Logger } from "@outboxy/logging";
import type { MaintenanceOperations } from "@outboxy/db-adapter-core";
import type { WorkerMetrics } from "./metrics/index.js";

export interface MaintenanceSchedulerConfig {
  staleRecoveryIntervalMs: number;
  staleEventThresholdMs: number;
  idempotencyCleanupEnabled: boolean;
  idempotencyCleanupIntervalMs: number;
  idempotencyRetentionDays: number;
  inboxCleanupEnabled: boolean;
  inboxCleanupIntervalMs: number;
  inboxRetentionDays: number;
}

export interface MaintenanceScheduler {
  start(): void;
  stop(): void;
}

export function createMaintenanceScheduler(
  maintenance: MaintenanceOperations,
  config: MaintenanceSchedulerConfig,
  logger: Logger,
  metrics?: WorkerMetrics,
): MaintenanceScheduler {
  let staleRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  let staleRecoveryRunning = false;
  let idempotencyCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let inboxCleanupTimer: ReturnType<typeof setInterval> | null = null;

  function startStaleRecovery(): void {
    logger.info(
      {
        intervalMs: config.staleRecoveryIntervalMs,
        thresholdMs: config.staleEventThresholdMs,
      },
      "Starting stale event recovery scheduler",
    );

    staleRecoveryTimer = setInterval(async () => {
      if (staleRecoveryRunning) {
        logger.debug("Stale recovery already running, skipping this iteration");
        return;
      }
      staleRecoveryRunning = true;
      try {
        const count = await maintenance.recoverStaleEvents(
          config.staleEventThresholdMs,
        );
        if (count > 0) {
          logger.warn({ recoveredCount: count }, "Recovered stale events");
          metrics?.staleEventsRecovered.inc(count);
        }
      } catch (error) {
        logger.error({ err: error }, "Stale event recovery failed");
      } finally {
        staleRecoveryRunning = false;
      }
    }, config.staleRecoveryIntervalMs);
  }

  function stopStaleRecovery(): void {
    if (staleRecoveryTimer) {
      logger.info("Stopping stale event recovery scheduler");
      clearInterval(staleRecoveryTimer);
      staleRecoveryTimer = null;
    }
  }

  function startIdempotencyCleanup(): void {
    if (!config.idempotencyCleanupEnabled) {
      logger.debug("Idempotency cleanup is disabled");
      return;
    }

    logger.info(
      {
        intervalMs: config.idempotencyCleanupIntervalMs,
        retentionDays: config.idempotencyRetentionDays,
      },
      "Starting idempotency cleanup scheduler",
    );

    idempotencyCleanupTimer = setInterval(async () => {
      try {
        const count = await maintenance.cleanupStaleIdempotencyKeys(
          config.idempotencyRetentionDays,
        );
        if (count > 0) {
          logger.info(
            { clearedCount: count },
            "Cleared stale idempotency keys",
          );
          metrics?.idempotencyKeysCleaned.inc(count);
        }
      } catch (error) {
        logger.error({ err: error }, "Idempotency cleanup failed");
      }
    }, config.idempotencyCleanupIntervalMs);
  }

  function stopIdempotencyCleanup(): void {
    if (idempotencyCleanupTimer) {
      logger.info("Stopping idempotency cleanup scheduler");
      clearInterval(idempotencyCleanupTimer);
      idempotencyCleanupTimer = null;
    }
  }

  function startInboxCleanup(): void {
    if (!config.inboxCleanupEnabled) {
      logger.debug("Inbox cleanup is disabled");
      return;
    }

    if (!maintenance.cleanupProcessedInboxEvents) {
      logger.warn(
        "Inbox cleanup enabled but adapter does not implement cleanupProcessedInboxEvents",
      );
      return;
    }

    logger.info(
      {
        intervalMs: config.inboxCleanupIntervalMs,
        retentionDays: config.inboxRetentionDays,
      },
      "Starting inbox cleanup scheduler",
    );

    inboxCleanupTimer = setInterval(async () => {
      try {
        const count = await maintenance.cleanupProcessedInboxEvents!(
          config.inboxRetentionDays,
        );
        if (count > 0) {
          logger.info(
            { deletedCount: count },
            "Cleaned up processed inbox events",
          );
          metrics?.inboxEventsCleaned.inc(count);
        }
      } catch (error) {
        logger.error({ err: error }, "Inbox cleanup failed");
      }
    }, config.inboxCleanupIntervalMs);
  }

  function stopInboxCleanup(): void {
    if (inboxCleanupTimer) {
      logger.info("Stopping inbox cleanup scheduler");
      clearInterval(inboxCleanupTimer);
      inboxCleanupTimer = null;
    }
  }

  return {
    start() {
      startStaleRecovery();
      startIdempotencyCleanup();
      startInboxCleanup();
    },
    stop() {
      stopStaleRecovery();
      stopIdempotencyCleanup();
      stopInboxCleanup();
    },
  };
}
