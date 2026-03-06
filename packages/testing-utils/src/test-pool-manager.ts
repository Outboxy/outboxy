/**
 * Test pool manager for PostgreSQL database connections
 *
 * Manages PostgreSQL connection pools with isolated test schemas.
 * Each test file gets its own schema for complete test isolation.
 *
 * @packageDocumentation
 */

import { Pool, type PoolConfig } from "pg";
import { getTestContainerConfig } from "./setupTests.js";
import { retryWithBackoff, isConnectionError } from "./retry-helpers.js";

// Track pools for cleanup
const pools: Pool[] = [];

export interface TestPoolConfig extends Omit<
  PoolConfig,
  "host" | "port" | "database" | "user" | "password"
> {
  /** Pool name for logging (optional) */
  name?: string;
  /** Skip creating the outbox_events table (useful for migration tests) */
  skipTableCreation?: boolean;
}

/**
 * Truncate all tables for test cleanup
 *
 * Resets database state between tests without recreating the container.
 * Uses CASCADE and handles the case where tables may not exist (e.g., during migration tests).
 *
 * @param pool - The pool to use for truncation
 *
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await truncateAllTables(pool);
 * });
 * ```
 */
export async function truncateAllTables(pool: Pool): Promise<void> {
  const tables = ["outbox_events", "inbox_events"];

  for (const table of tables) {
    try {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch {
      // Table may not exist in this schema (e.g., during migration tests)
    }
  }
}

/**
 * Clean up all tracked test pools
 *
 * Called automatically during global teardown, but can be called manually if needed.
 */
export async function cleanupAllTestPools(): Promise<void> {
  for (const pool of pools) {
    await pool.end();
  }
  pools.length = 0;
}

/**
 * Result from createIsolatedTestPool
 */
export interface IsolatedTestPool {
  /** The connection pool with search_path set to isolated schema */
  pool: Pool;
  /** The name of the isolated schema */
  schemaName: string;
  /** Cleanup function to drop the schema and close the pool */
  cleanup: () => Promise<void>;
}

/**
 * Checks whether an error is retryable during table copy operations.
 *
 * Extends connection errors with PostgreSQL concurrency codes that arise when
 * concurrent migrations hold locks on the source table during LIKE ... INCLUDING ALL.
 */
function isTableCopyRetryable(error: unknown): boolean {
  if (isConnectionError(error)) return true;
  const code = (error as { code?: string }).code;
  // 55006 = object_in_use, 55P03 = lock_not_available, 23505 = unique_violation (index race)
  return code === "55006" || code === "55P03" || code === "23505";
}

interface TableCopySpec {
  table: string;
  indexName: string;
  indexSql: string;
}

/**
 * Copy a table from public schema into the isolated test schema with retries.
 *
 * LIKE ... INCLUDING ALL may miss partial indexes under concurrent migrations,
 * so we explicitly create the required unique index as a safety net.
 */
async function copyTableWithIndex(
  adminPool: Pool,
  schemaName: string,
  spec: TableCopySpec,
  retryName?: string,
): Promise<void> {
  await retryWithBackoff(
    async () => {
      await adminPool.query(
        `DROP TABLE IF EXISTS "${schemaName}"."${spec.table}" CASCADE`,
      );
      await adminPool.query(`
        CREATE TABLE "${schemaName}"."${spec.table}" (LIKE public."${spec.table}" INCLUDING ALL)
      `);
      await adminPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${spec.indexName}"
          ON "${schemaName}"."${spec.table}" ${spec.indexSql}
      `);
    },
    {
      name: retryName,
      maxAttempts: 5,
      baseDelayMs: 200,
      isRetryable: isTableCopyRetryable,
    },
  );
}

/**
 * Create an isolated test pool with its own schema
 *
 * Each test file gets its own PostgreSQL schema, enabling parallel test execution
 * without data conflicts. The schema is automatically dropped when cleanup() is called.
 *
 * @param config - Optional pool configuration
 * @returns Pool, schema name, and cleanup function
 *
 * @example
 * ```typescript
 * let pool: Pool;
 * let cleanup: () => Promise<void>;
 *
 * beforeAll(async () => {
 *   const result = await createIsolatedTestPool({ name: "worker-e2e" });
 *   pool = result.pool;
 *   cleanup = result.cleanup;
 * });
 *
 * afterAll(async () => {
 *   await cleanup();
 * });
 *
 * beforeEach(async () => {
 *   await pool.query("TRUNCATE outbox_events CASCADE");
 * });
 * ```
 */
export async function createIsolatedTestPool(
  config: TestPoolConfig = {},
): Promise<IsolatedTestPool> {
  const containerConfig = getTestContainerConfig();
  const { name, skipTableCreation, ...poolConfig } = config;

  const schemaName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // When multiple packages run tests in parallel, containers may not be immediately ready
  const adminPool = new Pool({
    host: containerConfig.pgHost,
    port: containerConfig.pgPort,
    database: containerConfig.pgDatabase,
    user: containerConfig.pgUser,
    password: containerConfig.pgPassword,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  try {
    await retryWithBackoff(
      async () => {
        await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
      },
      { name },
    );

    if (!skipTableCreation) {
      await copyTableWithIndex(
        adminPool,
        schemaName,
        {
          table: "outbox_events",
          indexName: "idx_test_outbox_idempotency",
          indexSql:
            "USING btree (idempotency_key) WHERE idempotency_key IS NOT NULL AND status != 'succeeded'",
        },
        name,
      );

      const inboxExists = await adminPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'inbox_events'
        )
      `);

      if (inboxExists.rows[0].exists) {
        await copyTableWithIndex(
          adminPool,
          schemaName,
          {
            table: "inbox_events",
            indexName: "idx_test_inbox_idempotency",
            indexSql: "USING btree (idempotency_key)",
          },
          name,
        );
      }
    }
  } finally {
    await adminPool.end();
  }

  // Create test pool with search_path set via connection options
  // Using options parameter ensures search_path is set BEFORE connection is returned,
  // avoiding the race condition with pool.on("connect") which doesn't await
  const pool = new Pool({
    host: containerConfig.pgHost,
    port: containerConfig.pgPort,
    database: containerConfig.pgDatabase,
    user: containerConfig.pgUser,
    password: containerConfig.pgPassword,
    max: 20,
    options: `-c search_path="${schemaName}",public`,
    ...poolConfig,
  });

  // Verify connection works
  const client = await pool.connect();
  client.release();

  pools.push(pool);

  if (name) {
    console.log(
      `📊 Isolated test pool '${name}' created with schema '${schemaName}'`,
    );
  }

  const cleanup = async () => {
    // Remove from tracked pools
    const index = pools.indexOf(pool);
    if (index > -1) {
      pools.splice(index, 1);
    }

    // Close the test pool first
    await pool.end();

    // Drop the schema using a new connection
    const cleanupPool = new Pool({
      host: containerConfig.pgHost,
      port: containerConfig.pgPort,
      database: containerConfig.pgDatabase,
      user: containerConfig.pgUser,
      password: containerConfig.pgPassword,
      max: 1,
    });

    try {
      await cleanupPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await cleanupPool.end();
    }
  };

  return { pool, schemaName, cleanup };
}
