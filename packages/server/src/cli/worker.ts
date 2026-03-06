#!/usr/bin/env node
/**
 * CLI entry point for running the Outboxy worker
 *
 * This script reads publisher and database configuration from environment variables
 * and starts the worker with the appropriate publisher and adapter.
 *
 * Environment Variables:
 * - DATABASE_URL: Database connection string (required)
 * - DATABASE_TYPE: "postgresql" or "mysql" (auto-detected from URL if not specified)
 * - PUBLISHER_TYPE: "http" (default) or "kafka"
 * - For HTTP: HTTP_TIMEOUT_MS
 * - For Kafka: KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_COMPRESSION_TYPE, etc.
 * - WORKER_COUNT: Number of worker instances (default: 1)
 * - LOG_LEVEL: Logging level (default: info)
 */

import { createLogger } from "@outboxy/logging";
import { startWorker, WorkerCluster } from "@outboxy/worker";
import { loadConfig, loadWorkerConfig } from "../config.js";
import { createDatabaseAdapter } from "../adapter-factory.js";
import { createPublisherFromEnv } from "../publisher-factory.js";

async function main() {
  const serverConfig = loadConfig();
  const workerConfig = loadWorkerConfig();
  const logger = createLogger({
    service: "outboxy-worker",
    level: serverConfig.logLevel,
    version: process.env.npm_package_version,
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled rejection — shutting down");
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception — shutting down");
    process.exit(1);
  });

  // Create database adapter
  const poolSize = WorkerCluster.calculatePoolSize(workerConfig.workerCount);
  logger.info(
    {
      connectionString: serverConfig.databaseUrl.replace(/:[^:@]+@/, ":***@"),
      poolSize,
      databaseType: serverConfig.databaseType ?? "auto-detect",
    },
    "Creating database adapter for worker",
  );

  const adapter = await createDatabaseAdapter({
    connectionString: serverConfig.databaseUrl,
    databaseType: serverConfig.databaseType,
    maxConnections: poolSize,
    logger,
  });

  // Create publisher from environment variables
  const publisherType = process.env.PUBLISHER_TYPE || "http";
  logger.info({ publisherType }, "Creating publisher");

  let publisher = await createPublisherFromEnv(logger);

  // Apply optional publisher wrapper (e.g., tracing, logging, metrics).
  // The module must export a `wrapPublisher(publisher: Publisher): Publisher` function.
  const wrapperModule = process.env.OUTBOXY_PUBLISHER_WRAPPER;
  if (wrapperModule) {
    try {
      const { wrapPublisher } = await import(wrapperModule);
      publisher = wrapPublisher(publisher);
      logger.info({ module: wrapperModule }, "Publisher wrapper applied");
    } catch (err) {
      logger.warn(
        { err, module: wrapperModule },
        "Failed to load publisher wrapper",
      );
    }
  }

  // Start worker
  const worker = await startWorker({
    publisher,
    adapter,
    config: workerConfig,
    logger,
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    logger.info("Shutting down worker...");
    try {
      await worker.stop();
      await adapter.shutdown();
      logger.info("Worker shutdown complete");
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Export main function for use by unified CLI
export { main as workerMain };

// Only run main() when this file is executed directly (not when imported)
if (import.meta.url.startsWith("file:")) {
  const modulePath = import.meta.url.slice(7); // Remove 'file:' prefix
  // Decode URI components to handle special characters
  const decodedPath = decodeURIComponent(modulePath);
  const scriptPath = process.argv[1] ?? "";

  // Check if this file is being run directly (not imported)
  if (decodedPath === scriptPath || scriptPath.endsWith(decodedPath)) {
    main().catch((error) => {
      const logger = createLogger({ service: "outboxy-worker" });
      logger.fatal({ err: error }, "Fatal error during worker startup");
      process.exit(1);
    });
  }
}
