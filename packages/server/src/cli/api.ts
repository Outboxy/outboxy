#!/usr/bin/env node
/**
 * CLI entry point for running the Outboxy API server
 *
 * This script reads configuration from environment variables,
 * creates the appropriate database adapter, and starts the API server.
 *
 * Environment Variables:
 * - DATABASE_URL: Database connection string (required)
 * - DATABASE_TYPE: "postgresql" or "mysql" (auto-detected from URL if not specified)
 * - PORT: API server port (default: 3000)
 * - HOST: API server bind address (default: 0.0.0.0)
 * - LOG_LEVEL: Logging level (default: info)
 * - DB_POOL_MAX: Maximum database connections (default: 20)
 * - DB_POOL_MIN: Minimum database connections (default: 2)
 */

import { createLogger } from "@outboxy/logging";
import { createServer } from "@outboxy/api";
import { loadConfig, loadApiConfig } from "../config.js";
import { createDatabaseAdapter } from "../adapter-factory.js";

async function main() {
  const serverConfig = loadConfig();
  const apiConfig = loadApiConfig();
  const logger = createLogger({
    service: "outboxy-api",
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
  logger.info(
    {
      connectionString: serverConfig.databaseUrl.replace(/:[^:@]+@/, ":***@"),
      databaseType: serverConfig.databaseType ?? "auto-detect",
    },
    "Creating database adapter for API server",
  );

  const adapter = await createDatabaseAdapter({
    connectionString: serverConfig.databaseUrl,
    databaseType: serverConfig.databaseType,
    maxConnections: serverConfig.dbPoolMax,
    minConnections: serverConfig.dbPoolMin,
    connectionTimeoutMs: serverConfig.dbConnectionTimeoutMs,
    statementTimeoutMs: serverConfig.dbStatementTimeoutMs,
    logger,
  });

  // Create and start server
  const server = await createServer({
    adapter,
    config: apiConfig,
  });

  // Start listening
  await server.listen({ port: apiConfig.port, host: apiConfig.host });
  logger.info(
    { port: apiConfig.port, host: apiConfig.host },
    "API server listening",
  );

  // Graceful shutdown handling
  const shutdown = async () => {
    logger.info("Shutting down API server...");
    try {
      await server.close();
      await adapter.shutdown();
      logger.info("API server shutdown complete");
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
export { main as apiMain };

// Only run main() when this file is executed directly (not when imported)
if (import.meta.url.startsWith("file:")) {
  const modulePath = import.meta.url.slice(7); // Remove 'file:' prefix
  // Decode URI components to handle special characters
  const decodedPath = decodeURIComponent(modulePath);
  const scriptPath = process.argv[1] ?? "";

  // Check if this file is being run directly (not imported)
  if (decodedPath === scriptPath || scriptPath.endsWith(decodedPath)) {
    main().catch((error) => {
      const logger = createLogger({ service: "outboxy-api" });
      logger.fatal({ err: error }, "Fatal error during API server startup");
      process.exit(1);
    });
  }
}
