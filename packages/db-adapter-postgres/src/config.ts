import { z } from "zod";
import { type Logger, noopLogger } from "@outboxy/db-adapter-core";

export type { Logger };
export { noopLogger };

/**
 * PostgreSQL adapter configuration schema
 */
export const PostgresAdapterConfigSchema = z.object({
  /** Database connection string */
  connectionString: z.string().min(1, "Connection string is required"),

  /** Maximum number of connections in pool */
  maxConnections: z.number().int().min(1).max(100).default(20),

  /** Minimum number of connections in pool */
  minConnections: z.number().int().min(0).max(50).default(2),

  /** Connection timeout in milliseconds */
  connectionTimeoutMs: z.number().int().min(1000).max(60000).default(5000),

  /** Idle connection timeout in milliseconds */
  idleTimeoutMs: z.number().int().min(1000).max(300000).default(30000),

  /** Statement timeout in milliseconds */
  statementTimeoutMs: z.number().int().min(1000).max(300000).default(10000),

  /** Maximum connection retry attempts */
  maxRetries: z.number().int().min(0).max(10).default(3),

  /** Base delay between retries in milliseconds */
  retryDelayMs: z.number().int().min(100).max(30000).default(1000),
});

/**
 * PostgreSQL adapter configuration type (input - allows defaults to be omitted)
 */
export type PostgresAdapterConfig = z.input<
  typeof PostgresAdapterConfigSchema
> & {
  /** Optional logger instance */
  logger?: Logger;
};
