import { Pool } from "pg";
import { ConnectionError } from "../errors.js";
import type { PostgresAdapterConfig, Logger } from "../config.js";
import { noopLogger } from "../config.js";

/**
 * Create a PostgreSQL connection pool with production-ready features
 *
 * Features:
 * - Automatic retry on connection failure with exponential backoff
 * - Health checks on startup
 * - Connection lifecycle logging
 * - Error event handling
 */
export async function createPool(
  config: PostgresAdapterConfig,
  logger: Logger = noopLogger,
): Promise<Pool> {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 20,
    min: config.minConnections ?? 2,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5000,
    statement_timeout: config.statementTimeoutMs ?? 10000,
  });

  // Connection lifecycle logging
  pool.on("connect", () => {
    logger.debug("New client connected to database");
  });

  pool.on("acquire", () => {
    logger.debug("Client acquired from pool");
  });

  pool.on("remove", () => {
    logger.debug("Client removed from pool");
  });

  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected database pool error");
  });

  // Test connection with retry logic
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        logger.info(
          { attempt, maxRetries },
          "Database connection pool established",
        );
        return pool;
      } finally {
        client.release();
      }
    } catch (error) {
      lastError = error as Error;
      logger.warn(
        { attempt, maxRetries, error: lastError.message },
        "Database connection attempt failed",
      );

      if (attempt < maxRetries) {
        const delayMs = retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted - clean up pool
  await pool.end().catch(() => {});

  throw new ConnectionError(
    `Failed to connect to database after ${maxRetries} attempts: ${lastError?.message}`,
    lastError,
  );
}

/**
 * Gracefully shutdown connection pool with timeout
 */
export async function shutdownPool(
  pool: Pool,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Pool shutdown timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    pool
      .end()
      .then(() => {
        clearTimeout(timeout);
        resolve();
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
