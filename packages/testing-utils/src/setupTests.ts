/**
 * Test setup file for Vitest
 *
 * Provides helper functions to access injected test container configuration.
 *
 * @packageDocumentation
 */

import { inject } from "vitest";
import type { TestContainerConfig } from "./globalSetup.js";

/**
 * Get the test container configuration injected by globalSetup
 *
 * @returns The test container configuration with PostgreSQL and Kafka connection details
 * @throws If called outside of a test context
 *
 * @example
 * ```typescript
 * const config = getTestContainerConfig();
 * const pool = new Pool({ connectionString: config.pgConnectionString });
 * ```
 */
export function getTestContainerConfig(): TestContainerConfig {
  return inject("testContainerConfig");
}

/**
 * Get the PostgreSQL connection string from test containers
 *
 * @returns PostgreSQL connection string
 *
 * @example
 * ```typescript
 * const connectionString = getTestPgConnectionString();
 * const pool = new Pool({ connectionString });
 * ```
 */
export function getTestPgConnectionString(): string {
  return getTestContainerConfig().pgConnectionString;
}

/**
 * Get the Kafka broker address from test containers
 *
 * @returns Kafka broker address (e.g., "localhost:32768")
 *
 * @example
 * ```typescript
 * const broker = getTestKafkaBroker();
 * const kafka = new Kafka({ brokers: [broker] });
 * ```
 */
export function getTestKafkaBroker(): string {
  return getTestContainerConfig().kafkaBroker;
}

/**
 * Get the PostgreSQL connection string with a specific schema search_path
 *
 * Use this when creating adapters that need to work with an isolated test schema.
 *
 * @param schemaName - The schema name to set in search_path
 * @returns PostgreSQL connection string with search_path option
 *
 * @example
 * ```typescript
 * const { schemaName } = await createIsolatedTestPool();
 * const connectionString = getTestPgConnectionStringWithSchema(schemaName);
 * const adapter = await createPostgresAdapter({ connectionString });
 * ```
 */
export function getTestPgConnectionStringWithSchema(
  schemaName: string,
): string {
  const baseConnectionString = getTestContainerConfig().pgConnectionString;
  const separator = baseConnectionString.includes("?") ? "&" : "?";
  return `${baseConnectionString}${separator}options=-c search_path=${schemaName},public`;
}

/**
 * Get the MySQL connection string from test containers
 *
 * @returns MySQL connection string
 *
 * @example
 * ```typescript
 * const connectionString = getTestMySqlConnectionString();
 * const pool = mysql2.createPool(connectionString);
 * ```
 */
export function getTestMySqlConnectionString(): string {
  return getTestContainerConfig().mysqlConnectionString;
}

/**
 * Get the MySQL connection configuration from test containers
 *
 * @returns MySQL connection configuration object
 *
 * @example
 * ```typescript
 * const config = getTestMySqlConfig();
 * const pool = mysql2.createPool({
 *   host: config.host,
 *   port: config.port,
 *   user: config.user,
 *   password: config.password,
 *   database: config.database,
 * });
 * ```
 */
export function getTestMySqlConfig(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} {
  const config = getTestContainerConfig();
  return {
    host: config.mysqlHost,
    port: config.mysqlPort,
    database: config.mysqlDatabase,
    user: config.mysqlUser,
    password: config.mysqlPassword,
  };
}

/**
 * Get the MySQL admin configuration from test containers
 *
 * Returns root user credentials for database creation operations.
 * Use this for creating isolated test databases.
 *
 * @returns MySQL admin connection configuration object with root credentials
 *
 * @example
 * ```typescript
 * const adminConfig = getTestMySqlAdminConfig();
 * const adminPool = mysql2.createPool({
 *   host: adminConfig.host,
 *   port: adminConfig.port,
 *   user: adminConfig.user,  // 'root'
 *   password: adminConfig.password,
 * });
 * ```
 */
export function getTestMySqlAdminConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
} {
  const config = getTestContainerConfig();
  return {
    host: config.mysqlHost,
    port: config.mysqlPort,
    user: config.mysqlRootUser,
    password: config.mysqlRootPassword,
  };
}
