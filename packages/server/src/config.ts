/**
 * Server Configuration
 *
 * Unified configuration loading for the server package.
 * Re-exports configuration from api and worker packages.
 */

import { z } from "zod";
import { loadAndValidateConfig } from "@outboxy/logging";

/**
 * Server configuration schema
 *
 * Combines database configuration (for adapter creation) with
 * the ability to delegate to API and Worker specific configs.
 */
const serverConfigSchema = z
  .object({
    /** Database connection string (required) */
    databaseUrl: z.string().url(),

    /** Database type: "postgresql" or "mysql" (auto-detected from URL if not specified) */
    databaseType: z.enum(["postgresql", "mysql"]).optional(),

    /** Maximum database connections in pool */
    dbPoolMax: z.coerce.number().int().positive().default(20),

    /** Minimum database connections in pool */
    dbPoolMin: z.coerce.number().int().nonnegative().default(2),

    /** Database connection timeout in milliseconds */
    dbConnectionTimeoutMs: z.coerce.number().int().positive().default(5000),

    /** Database statement timeout in milliseconds */
    dbStatementTimeoutMs: z.coerce.number().int().positive().default(10000),

    /** Logging level */
    logLevel: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),

    /** Node.js environment */
    nodeEnv: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .strict();

export type ServerConfig = z.infer<typeof serverConfigSchema>;

/**
 * Load and validate server configuration from environment variables
 *
 * @returns Validated configuration object
 * @throws Exits process with code 1 on validation failure
 */
export function loadConfig(): ServerConfig {
  return loadAndValidateConfig(
    serverConfigSchema,
    {
      databaseUrl: process.env.DATABASE_URL,
      databaseType: process.env.DATABASE_TYPE,
      dbPoolMax: process.env.DB_POOL_MAX,
      dbPoolMin: process.env.DB_POOL_MIN,
      dbConnectionTimeoutMs: process.env.DB_CONNECTION_TIMEOUT_MS,
      dbStatementTimeoutMs: process.env.DB_STATEMENT_TIMEOUT_MS,
      logLevel: process.env.LOG_LEVEL,
      nodeEnv: process.env.NODE_ENV,
    },
    { serviceName: "outboxy-server" },
  );
}

// Re-export API and Worker configs for convenience
// These will be used when creating API server or Worker instances
export { loadConfig as loadApiConfig, type ApiConfig } from "@outboxy/api";
export {
  loadConfig as loadWorkerConfig,
  type WorkerConfig,
} from "@outboxy/worker";
