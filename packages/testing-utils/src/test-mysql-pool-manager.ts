/**
 * Test pool manager for MySQL database connections
 *
 * Manages MySQL connection pools with isolated test databases.
 * Each test file gets its own database for complete test isolation.
 *
 * @packageDocumentation
 */

import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import type { PoolOptions } from "mysql2/promise";
import { getTestMySqlConfig, getTestMySqlAdminConfig } from "./setupTests.js";
import { runMigrations } from "@outboxy/migrations";
import { retryWithBackoff } from "./retry-helpers.js";

// Track pools for cleanup
const pools: Pool[] = [];

export interface TestMySqlPoolConfig extends Omit<
  PoolOptions,
  "host" | "port" | "user" | "password" | "database"
> {
  /** Pool name for logging (optional) */
  name?: string;
  /** Skip creating the outbox_events table (useful for migration tests) */
  skipTableCreation?: boolean;
}

/**
 * Result from createIsolatedTestMySqlPool
 */
export interface IsolatedTestMySqlPool {
  /** Connection pool to isolated database */
  pool: Pool;
  /** Name of isolated database */
  databaseName: string;
  /** Cleanup function to drop database and close pool */
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated MySQL test pool with its own database
 *
 * Each test file gets its own MySQL database, enabling parallel test execution
 * without data conflicts. The database is automatically dropped when cleanup() is called.
 *
 * @param config - Optional pool configuration
 * @returns Pool, database name, and cleanup function
 *
 * @example
 * ```typescript
 * let pool: Pool;
 * let cleanup: () => Promise<void>;
 *
 * beforeAll(async () => {
 *   const result = await createIsolatedTestMySqlPool({ name: "mysql-e2e" });
 *   pool = result.pool;
 *   cleanup = result.cleanup;
 * });
 *
 * afterAll(async () => {
 *   await cleanup();
 * });
 *
 * beforeEach(async () => {
 *   await truncateAllTablesMySql(pool);
 * });
 * ```
 */
export async function createIsolatedTestMySqlPool(
  config: TestMySqlPoolConfig = {},
): Promise<IsolatedTestMySqlPool> {
  const containerConfig = getTestMySqlConfig();
  const adminConfig = getTestMySqlAdminConfig();
  const { name, skipTableCreation, ...poolConfig } = config;

  // Generate unique database name
  const databaseName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Create admin pool for database operations (no specific database)
  // Use root credentials for CREATE DATABASE permissions
  const adminPool = createPool({
    host: adminConfig.host,
    port: adminConfig.port,
    user: adminConfig.user,
    password: adminConfig.password,
    connectionLimit: 2,
    connectTimeout: 10000,
  });

  try {
    // Create isolated database with retry logic
    await retryWithBackoff(
      async () => {
        await adminPool.query(`CREATE DATABASE \`${databaseName}\``);
      },
      { name },
    );

    // Grant test user access to the isolated database with retry logic
    await retryWithBackoff(
      async () => {
        await adminPool.query(
          `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${containerConfig.user}'@'%'`,
        );
      },
      { name },
    );

    // Run migrations unless skipped (for migration tests)
    if (!skipTableCreation) {
      const isolatedConnectionString = `mysql://${containerConfig.user}:${containerConfig.password}@${containerConfig.host}:${containerConfig.port}/${databaseName}`;
      await runMigrations(isolatedConnectionString, "mysql");
    }
  } catch (error) {
    // Cleanup on failure
    await adminPool.end();
    throw error;
  }

  // Create test pool connected to isolated database
  const pool = createPool({
    host: containerConfig.host,
    port: containerConfig.port,
    database: databaseName,
    user: containerConfig.user,
    password: containerConfig.password,
    connectionLimit: 20,
    ...poolConfig,
  });

  // Verify connection
  await pool.query("SELECT 1");

  // Track pool for global cleanup
  pools.push(pool);

  if (name) {
    console.log(
      `📊 Isolated MySQL test pool '${name}' created with database '${databaseName}'`,
    );
  }

  const cleanup = async () => {
    // Remove from tracked pools
    const index = pools.indexOf(pool);
    if (index > -1) {
      pools.splice(index, 1);
    }

    // Close the test pool
    await pool.end();

    // Drop the isolated database using admin pool
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await adminPool.end();
    }
  };

  return { pool, databaseName, cleanup };
}

/**
 * Truncate all tables for test cleanup
 *
 * Resets database state between tests without recreating the container.
 * Uses MySQL-specific TRUNCATE syntax.
 *
 * @param pool - The pool to use for truncation
 *
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await truncateAllTablesMySql(pool);
 * });
 * ```
 */
export async function truncateAllTablesMySql(pool: Pool): Promise<void> {
  // Check if outbox_events table exists before truncating (handles migration test scenarios)
  const [outboxRows] = await pool.query<({ exists: number } & RowDataPacket)[]>(
    `
    SELECT EXISTS (
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
    ) as \`exists\`
  `,
  );

  if ((outboxRows[0]?.exists ?? 0) > 0) {
    await pool.query("TRUNCATE TABLE outbox_events");
  }

  // Check if inbox_events table exists before truncating (handles migration test scenarios)
  const [inboxRows] = await pool.query<({ exists: number } & RowDataPacket)[]>(
    `
    SELECT EXISTS (
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inbox_events'
    ) as \`exists\`
  `,
  );

  if ((inboxRows[0]?.exists ?? 0) > 0) {
    await pool.query("TRUNCATE TABLE inbox_events");
  }
}

/**
 * Clean up all tracked MySQL test pools
 *
 * Called automatically during global teardown, but can be called manually if needed.
 */
export async function cleanupAllTestMySqlPools(): Promise<void> {
  for (const pool of pools) {
    await pool.end();
  }
  pools.length = 0;
}
