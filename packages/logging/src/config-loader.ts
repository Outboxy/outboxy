/**
 * Configuration Loader Utility
 *
 * Provides a standardized way to load and validate configuration from
 * environment variables using Zod schemas.
 *
 * @packageDocumentation
 */

import { z, type ZodSchema } from "zod";
import { createBootstrapLogger } from "./logging/logger.js";

/**
 * Options for the config loader
 */
export interface ConfigLoaderOptions {
  /**
   * Name of the service (used for logging)
   */
  serviceName: string;

  /**
   * Whether to exit the process on validation failure
   * @default true
   */
  exitOnFailure?: boolean;
}

/**
 * Load and validate configuration from a raw object using a Zod schema
 *
 * On validation failure, logs the issues and either exits the process
 * or throws an error (depending on options).
 *
 * @param schema - Zod schema for validation
 * @param rawConfig - Raw configuration object (typically from environment variables)
 * @param options - Loader options
 * @returns Validated configuration
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { loadAndValidateConfig } from "@outboxy/logging";
 *
 * const myConfigSchema = z.object({
 *   port: z.coerce.number().int().positive().default(3000),
 *   host: z.string().default("0.0.0.0"),
 * });
 *
 * const config = loadAndValidateConfig(
 *   myConfigSchema,
 *   { port: process.env.PORT, host: process.env.HOST },
 *   { serviceName: "my-service" }
 * );
 * ```
 */
export function loadAndValidateConfig<T extends ZodSchema>(
  schema: T,
  rawConfig: Record<string, unknown>,
  options: ConfigLoaderOptions,
): z.infer<T> {
  const { serviceName, exitOnFailure = true } = options;

  try {
    return schema.parse(rawConfig) as z.infer<T>;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const logger = createBootstrapLogger(serviceName);
      logger.fatal(
        {
          err: error,
          issues: error.issues.map((issue: z.ZodIssue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        `${serviceName} configuration validation failed`,
      );

      if (exitOnFailure) {
        process.exit(1);
      }
    }
    throw error;
  }
}
