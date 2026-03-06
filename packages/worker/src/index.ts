import { createLogger, type Logger } from "@outboxy/logging";
import type { Publisher } from "@outboxy/publisher-core";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { loadConfig, type WorkerConfig } from "./config.js";
import { WorkerCluster } from "./core/worker-cluster.js";
import {
  createMetricsServer,
  createWorkerMetrics,
  type MetricsServer,
  type WorkerMetrics,
} from "./metrics/index.js";
import { resolveWorkerId } from "./utils/worker-identity.js";
import { createMaintenanceScheduler } from "./maintenance-scheduler.js";

/**
 * Options for starting the worker
 */
export interface WorkerOptions {
  /**
   * Publisher instance to use for delivering events.
   * Create this from @outboxy/publisher-http or @outboxy/publisher-kafka.
   */
  publisher: Publisher;

  /**
   * Database adapter for event storage operations.
   * Create this from @outboxy/db-adapter-postgres or another adapter implementation.
   */
  adapter: DatabaseAdapter;

  /**
   * Optional configuration overrides.
   * If not provided, configuration is loaded from environment variables.
   */
  config?: Partial<WorkerConfig>;

  /**
   * Optional custom logger.
   * If not provided, a default Pino logger is created.
   */
  logger?: Logger;
}

/**
 * Running worker instance with control methods
 */
export interface WorkerInstance {
  /** The worker cluster managing all worker processes */
  cluster: WorkerCluster;
  /** Stop the worker gracefully */
  stop: () => Promise<void>;
}

/**
 * Start an Outboxy worker with the provided publisher and database adapter
 *
 * @example
 * ```typescript
 * import { startWorker } from "@outboxy/worker";
 * import { HttpPublisher } from "@outboxy/publisher-http";
 * import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
 *
 * const adapter = await createPostgresAdapter({
 *   connectionString: process.env.DATABASE_URL!,
 *   maxConnections: 20,
 * });
 *
 * const publisher = new HttpPublisher({ timeoutMs: 30000 });
 * const worker = await startWorker({ publisher, adapter });
 *
 * // Later, to stop:
 * await worker.stop();
 * await adapter.shutdown();
 * ```
 */
export async function startWorker(
  options: WorkerOptions,
): Promise<WorkerInstance> {
  const config = { ...loadConfig(), ...options.config };
  const logger =
    options.logger ??
    createLogger({
      service: "outboxy-worker",
      level: config.logLevel,
      version: process.env.npm_package_version,
    });
  const adapter = options.adapter;

  const workerIdentity = resolveWorkerId(config.workerId);

  logger.info(
    {
      workerId: workerIdentity.id,
      workerIdSource: workerIdentity.source,
      pollIntervalMs: config.pollIntervalMs,
      batchSize: config.batchSize,
      maxRetries: config.maxRetries,
      workerCount: config.workerCount,
    },
    "Starting Outboxy Worker",
  );

  let metricsServer: MetricsServer | null = null;
  let workerMetrics: WorkerMetrics | undefined;

  if (config.metricsEnabled) {
    workerMetrics = createWorkerMetrics();
    metricsServer = createMetricsServer(
      {
        port: config.metricsPort,
        host: config.metricsHost,
        path: config.metricsPath,
      },
      logger,
    );
    await metricsServer.start();
  }

  const scheduler = createMaintenanceScheduler(
    adapter.maintenance,
    {
      staleRecoveryIntervalMs: config.staleRecoveryIntervalMs,
      staleEventThresholdMs: config.staleEventThresholdMs,
      idempotencyCleanupEnabled: config.idempotencyCleanupEnabled,
      idempotencyCleanupIntervalMs: config.idempotencyCleanupIntervalMs,
      idempotencyRetentionDays: config.idempotencyRetentionDays,
      inboxCleanupEnabled: config.inboxCleanupEnabled,
      inboxCleanupIntervalMs: config.inboxCleanupIntervalMs,
      inboxRetentionDays: config.inboxRetentionDays,
    },
    logger,
    workerMetrics,
  );
  scheduler.start();

  const publisherFactory = () => options.publisher;

  const cluster = new WorkerCluster(
    adapter.eventRepository,
    config,
    {
      workerCount: config.workerCount,
      workerIdPrefix: config.workerIdPrefix,
    },
    logger,
    publisherFactory,
    workerMetrics,
  );

  await cluster.start();

  const stop = async () => {
    logger.info("Shutdown signal received");

    scheduler.stop();
    await cluster.stop();

    if (metricsServer) {
      await metricsServer.stop();
    }

    logger.info("Shutdown complete");
  };

  return { cluster, stop };
}

// Re-export types and utilities
export { loadConfig, type WorkerConfig } from "./config.js";
export {
  WorkerCluster,
  type WorkerClusterConfig,
  type ClusterStatus,
} from "./core/worker-cluster.js";
export { OutboxWorker } from "./core/worker.js";
export { createLogger } from "@outboxy/logging";
export {
  createWorkerMetrics,
  createMetricsServer,
  type WorkerMetrics,
  type MetricsServer,
  type MetricsServerConfig,
} from "./metrics/index.js";
export { decideRetry } from "./retry.js";
export { groupBatchResults, type BatchGroupingResult } from "./batch.js";
export type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";
export type {
  DatabaseAdapter,
  EventRepository,
} from "@outboxy/db-adapter-core";
