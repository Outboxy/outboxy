/**
 * Global test setup for Vitest
 *
 * Starts PostgreSQL and Kafka containers ONCE before all tests,
 * with container reuse enabled for faster subsequent runs.
 *
 * @packageDocumentation
 */

import type { TestProject } from "vitest/node";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import {
  RedpandaContainer,
  type StartedRedpandaContainer,
} from "@testcontainers/redpanda";
import { runMigrations } from "@outboxy/migrations";
import { waitForServiceReady } from "./retry-helpers.js";

// Store containers for teardown
let postgresContainer: StartedTestContainer | null = null;
let mysqlContainer: StartedTestContainer | null = null;
let kafkaContainer: StartedRedpandaContainer | null = null;

export interface TestContainerConfig {
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  pgConnectionString: string;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlRootUser: string;
  mysqlRootPassword: string;
  mysqlConnectionString: string;
  kafkaBroker: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    testContainerConfig: TestContainerConfig;
  }
}

/**
 * Global setup function for Vitest
 * Starts PostgreSQL + Kafka containers once before all tests
 */
export async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const { provide } = project;
  const startTime = Date.now();
  console.log("🚀 Global test setup starting...");

  // Configuration
  const pgUser = "test";
  const pgPassword = "test";
  const pgDatabase = "outboxy_test";

  // Start PostgreSQL container with reuse support
  console.log("🐳 Starting PostgreSQL container...");
  postgresContainer = await new GenericContainer("postgres:16-alpine")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: pgUser,
      POSTGRES_PASSWORD: pgPassword,
      POSTGRES_DB: pgDatabase,
    })
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2),
    )
    .withStartupTimeout(120_000)
    .withReuse()
    .start();

  const pgHost = postgresContainer.getHost();
  const pgPort = postgresContainer.getMappedPort(5432);
  const pgConnectionString = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`;

  console.log(`✅ PostgreSQL started at ${pgConnectionString}`);

  // Wait for PostgreSQL to be fully ready using polling
  // Check if pg is available before attempting to use it (allows database-agnostic packages to skip)
  let pgAvailable = false;
  try {
    await import("pg");
    pgAvailable = true;
  } catch {
    console.log("ℹ️  pg not available, skipping PostgreSQL setup");
  }

  if (pgAvailable) {
    const { Pool } = await import("pg");
    await waitForServiceReady(
      async () => {
        const testPool = new Pool({
          host: pgHost,
          port: pgPort,
          database: pgDatabase,
          user: pgUser,
          password: pgPassword,
          max: 1,
          connectionTimeoutMillis: 1000,
        });
        try {
          const client = await testPool.connect();
          await client.query("SELECT 1");
          client.release();
        } finally {
          await testPool.end();
        }
      },
      { timeout: 30000, interval: 100, label: "PostgreSQL" },
    );

    // Force clean slate for migrations when reusing containers
    // This handles the case where previous test runs dropped tables
    const setupPool = new Pool({
      host: pgHost,
      port: pgPort,
      database: pgDatabase,
      user: pgUser,
      password: pgPassword,
      max: 5,
    });

    try {
      // Check if tables exist and are valid
      const tableCheck = await setupPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'outbox_events'
        ) as exists
      `);

      // If table doesn't exist, drop migration tracking to force fresh migrations
      if (!tableCheck.rows[0].exists) {
        console.log(
          "🔄 Detected stale container state, resetting migrations...",
        );
        await setupPool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
        await setupPool.query("DROP TABLE IF EXISTS __outboxy_migrations");
        await setupPool.query("DROP TABLE IF EXISTS inbox_events");
        await setupPool.query("DROP TABLE IF EXISTS outbox_config");
      }
    } finally {
      await setupPool.end();
    }

    // Run migrations (with retry for connection issues)
    console.log("📦 Running database migrations...");
    let migrationAttempts = 0;
    const maxAttempts = 3;
    while (migrationAttempts < maxAttempts) {
      try {
        await runMigrations(pgConnectionString);
        console.log("✅ Migrations complete");
        break;
      } catch (error) {
        migrationAttempts++;
        if (migrationAttempts >= maxAttempts) {
          console.error(
            `❌ Migration failed after ${maxAttempts} attempts:`,
            error,
          );
          throw error;
        }
        console.log(
          `⚠️ Migration attempt ${migrationAttempts} failed, retrying in 1s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // Start MySQL container with reuse support (optional - only if mysql2 is available)
  const mysqlDatabase = "outboxy_test";
  const mysqlUser = "test";
  const mysqlPassword = "test";
  const mysqlRootPassword = "root";
  let mysqlHost = "";
  let mysqlPort = 0;
  let mysqlConnectionString = "";

  // Check if mysql2 is available before trying to start MySQL container
  let mysql2Available = false;
  try {
    await import("mysql2/promise");
    mysql2Available = true;
  } catch {
    console.log("ℹ️  mysql2 not available, skipping MySQL setup");
  }

  if (mysql2Available) {
    console.log("🐳 Starting MySQL container...");
    mysqlContainer = await new GenericContainer("mysql:8.0")
      .withExposedPorts(3306)
      .withEnvironment({
        MYSQL_ROOT_PASSWORD: mysqlRootPassword,
        MYSQL_DATABASE: mysqlDatabase,
        MYSQL_USER: mysqlUser,
        MYSQL_PASSWORD: mysqlPassword,
      })
      .withWaitStrategy(Wait.forLogMessage("ready for connections"))
      .withStartupTimeout(120_000)
      .withReuse()
      .start();

    mysqlHost = mysqlContainer.getHost();
    mysqlPort = mysqlContainer.getMappedPort(3306);
    mysqlConnectionString = `mysql://${mysqlUser}:${mysqlPassword}@${mysqlHost}:${mysqlPort}/${mysqlDatabase}`;

    console.log(`✅ MySQL started at ${mysqlConnectionString}`);

    // Wait for MySQL to be fully ready using polling (slower startup than PostgreSQL)
    const mysql2 = await import("mysql2/promise");
    await waitForServiceReady(
      async () => {
        const testPool = mysql2.createPool({
          host: mysqlHost,
          port: mysqlPort,
          user: mysqlUser,
          password: mysqlPassword,
          database: mysqlDatabase,
          connectionLimit: 1,
          connectTimeout: 1000,
        });
        try {
          await testPool.query("SELECT 1");
        } finally {
          await testPool.end();
        }
      },
      { timeout: 60000, interval: 200, label: "MySQL" },
    );

    // Run MySQL migrations
    console.log("📦 Running MySQL database migrations...");
    let mysqlMigrationAttempts = 0;
    const mysqlMaxAttempts = 3;
    while (mysqlMigrationAttempts < mysqlMaxAttempts) {
      try {
        await runMigrations(mysqlConnectionString, "mysql");
        console.log("✅ MySQL migrations complete");
        break;
      } catch (error) {
        mysqlMigrationAttempts++;
        if (mysqlMigrationAttempts >= mysqlMaxAttempts) {
          console.error(
            `❌ MySQL migration failed after ${mysqlMaxAttempts} attempts:`,
            error,
          );
          throw error;
        }
        console.log(
          `⚠️ MySQL migration attempt ${mysqlMigrationAttempts} failed, retrying in 1s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // Start Kafka (Redpanda) container with reuse support
  console.log("🐳 Starting Kafka (Redpanda) container...");
  kafkaContainer = await new RedpandaContainer(
    "docker.redpanda.com/redpandadata/redpanda:v24.2.4",
  )
    .withReuse()
    .start();

  const kafkaBroker = kafkaContainer.getBootstrapServers();
  console.log(`✅ Kafka started at ${kafkaBroker}`);

  // Provide config to all test files
  const config: TestContainerConfig = {
    pgHost,
    pgPort,
    pgDatabase,
    pgUser,
    pgPassword,
    pgConnectionString,
    mysqlHost,
    mysqlPort,
    mysqlDatabase,
    mysqlUser,
    mysqlPassword,
    mysqlRootUser: "root",
    mysqlRootPassword,
    mysqlConnectionString,
    kafkaBroker,
  };

  provide("testContainerConfig", config);

  const elapsed = Date.now() - startTime;
  console.log(`🎉 Global test setup complete in ${elapsed}ms`);

  // Return teardown function
  // Note: We intentionally do NOT stop containers in teardown because:
  // 1. Tests run in parallel across packages - stopping containers while others are running causes failures
  // 2. Containers are started with .withReuse() - they're meant to persist for faster subsequent runs
  // 3. Docker will clean up containers when the testcontainers session ends
  return async () => {
    console.log("🧹 Global test teardown starting...");
    console.log(
      "♻️ Containers kept running for parallel test execution and reuse",
    );
    console.log("🎉 Global test teardown complete");
  };
}
