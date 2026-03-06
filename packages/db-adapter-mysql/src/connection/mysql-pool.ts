import mysql from "mysql2/promise";
import type { Pool, PoolOptions } from "mysql2/promise";
import type { MySQLAdapterConfig, Logger } from "../config.js";
import { ConnectionError } from "../errors.js";

/**
 * Parse MySQL connection string into pool options
 *
 * Validates URL format, required fields, and decodes URL-encoded credentials.
 * Throws ConnectionError for any parsing issues.
 */
function parseConnectionString(connectionString: string): PoolOptions {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new ConnectionError("Invalid MySQL connection string format");
  }

  if (!url.hostname) {
    throw new ConnectionError("MySQL connection string missing host");
  }

  const database = url.pathname.slice(1);
  if (!database) {
    throw new ConnectionError("MySQL connection string missing database name");
  }

  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/**
 * Create MySQL connection pool with retry logic
 */
export async function createPool(
  config: MySQLAdapterConfig,
  logger: Logger,
): Promise<Pool> {
  const baseOptions = parseConnectionString(config.connectionString);

  const poolOptions: PoolOptions = {
    ...baseOptions,
    connectionLimit: config.maxConnections ?? 20,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: config.connectionTimeoutMs ?? 5000,
  };

  let lastError: Error | null = null;
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger.info(
        { attempt, maxRetries: maxRetries + 1 },
        "Attempting to create MySQL connection pool",
      );

      const pool = mysql.createPool(poolOptions);

      // Add event handlers for observability
      pool.on("acquire", () => {
        logger.debug("Client acquired from MySQL pool");
      });

      pool.on("release", () => {
        logger.debug("Client released to MySQL pool");
      });

      pool.on("enqueue", () => {
        logger.debug("Waiting for available MySQL connection");
      });

      pool.on("connection", (connection) => {
        // Set session-level statement timeout (10 seconds)
        connection.query("SET SESSION max_execution_time = 10000");
        logger.debug("New MySQL connection established");
      });

      // Test connection
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();

      logger.info(
        {
          host: baseOptions.host,
          port: baseOptions.port,
          database: baseOptions.database,
          connectionLimit: poolOptions.connectionLimit,
        },
        "MySQL connection pool created successfully",
      );

      return pool;
    } catch (error) {
      lastError = error as Error;
      logger.warn(
        {
          attempt,
          maxRetries: maxRetries + 1,
          error: lastError.message,
        },
        "Failed to create MySQL connection pool",
      );

      if (attempt <= maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        logger.info({ delayMs: delay }, "Retrying connection");
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new ConnectionError(
    `Failed to connect to MySQL after ${maxRetries + 1} attempts: ${lastError?.message}`,
    lastError ?? undefined,
  );
}

/**
 * Gracefully shutdown MySQL connection pool
 */
export async function shutdownPool(
  pool: Pool,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Pool shutdown timed out after ${timeoutMs}ms`));
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
