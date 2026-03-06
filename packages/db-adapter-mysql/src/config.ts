import { z } from "zod";
import { type Logger, noopLogger } from "@outboxy/db-adapter-core";

export type { Logger };
export { noopLogger };

/**
 * MySQL adapter configuration schema
 */
export const MySQLAdapterConfigSchema = z.object({
  /** Database connection string (mysql://user:pass@host:port/database) */
  connectionString: z.string().min(1, "Connection string is required"),

  /** Maximum number of connections in pool */
  maxConnections: z.number().int().min(1).max(100).default(20),

  /** Connection timeout in milliseconds */
  connectionTimeoutMs: z.number().int().min(1000).max(60000).default(5000),

  /** Maximum connection retry attempts */
  maxRetries: z.number().int().min(0).max(10).default(3),

  /** Base delay between retries in milliseconds */
  retryDelayMs: z.number().int().min(100).max(30000).default(1000),
});

/**
 * MySQL adapter configuration type (input - allows defaults to be omitted)
 */
export type MySQLAdapterConfig = z.input<typeof MySQLAdapterConfigSchema> & {
  /** Optional logger instance */
  logger?: Logger;
};
