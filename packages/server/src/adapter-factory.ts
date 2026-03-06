/**
 * Database Adapter Factory
 *
 * Centralized creation of database adapters for the server package.
 * Consolidates logic from api/src/plugins/database.plugin.ts and worker/src/bin/start.ts
 */

import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import {
  detectDatabaseType,
  isDetectionSuccess,
  type DetectorMap,
} from "@outboxy/db-adapter-core";
import {
  createPostgresAdapter,
  canHandle as canHandlePostgres,
} from "@outboxy/db-adapter-postgres";
import type { Logger } from "@outboxy/logging";

export interface CreateAdapterOptions {
  /** Database connection string */
  connectionString: string;
  /** Database type (auto-detected from URL if not specified) */
  databaseType?: "postgresql" | "mysql";
  /** Maximum database connections in pool */
  maxConnections: number;
  /** Minimum database connections in pool (PostgreSQL only) */
  minConnections?: number;
  /** Database connection timeout in milliseconds (PostgreSQL only) */
  connectionTimeoutMs?: number;
  /** Database statement timeout in milliseconds (PostgreSQL only) */
  statementTimeoutMs?: number;
  /** Logger instance */
  logger: Logger;
}

/**
 * Create a database adapter with auto-detection
 *
 * Detects database type from connection string and creates the appropriate adapter.
 * Supports PostgreSQL and MySQL.
 *
 * @param options - Adapter creation options
 * @returns Database adapter instance
 * @throws Error if database type detection fails or adapter creation fails
 */
export async function createDatabaseAdapter(
  options: CreateAdapterOptions,
): Promise<DatabaseAdapter> {
  const {
    connectionString,
    databaseType,
    maxConnections,
    minConnections,
    connectionTimeoutMs,
    statementTimeoutMs,
    logger,
  } = options;

  // Dynamic import for MySQL detector (keeps it optional)
  const { canHandle: canHandleMySql } =
    await import("@outboxy/db-adapter-mysql");

  const detectors: DetectorMap = {
    mysql: canHandleMySql,
    postgres: canHandlePostgres,
  };

  const detection = detectDatabaseType(
    connectionString,
    databaseType,
    detectors,
  );

  if (!isDetectionSuccess(detection)) {
    throw new Error(detection.error);
  }

  if (detection.ambiguous) {
    logger.warn(
      { connectionString: connectionString.replace(/:[^:@]+@/, ":***@") },
      "Database URL matches multiple patterns, defaulting to PostgreSQL",
    );
  }

  if (detection.type === "mysql") {
    logger.info({ databaseType: "mysql" }, "Creating database adapter");
    const { createMySQLAdapter } = await import("@outboxy/db-adapter-mysql");
    return createMySQLAdapter({
      connectionString,
      maxConnections,
      logger,
    });
  }

  logger.info({ databaseType: "postgresql" }, "Creating database adapter");
  return createPostgresAdapter({
    connectionString,
    maxConnections,
    minConnections,
    connectionTimeoutMs,
    statementTimeoutMs,
    logger,
  });
}
