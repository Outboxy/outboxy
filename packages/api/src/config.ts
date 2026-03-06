import { z } from "zod";
import { loadAndValidateConfig } from "@outboxy/logging";

/**
 * API server configuration schema
 *
 * Validated at startup using Zod. Follows the same pattern as worker/src/config.ts.
 */
const apiConfigSchema = z.object({
  /** API server port */
  port: z.coerce.number().int().positive().default(3000),

  /** API server bind address */
  host: z.string().default("0.0.0.0"),

  /** Logging level */
  logLevel: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  /** Request timeout in milliseconds */
  requestTimeoutMs: z.coerce.number().int().positive().default(30000),

  /** Maximum request body size in bytes */
  bodyLimit: z.coerce.number().int().positive().default(1048576), // 1MB

  /** Enable Swagger UI at /docs */
  swaggerEnabled: z.coerce.boolean().default(true),

  /** Node.js environment */
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

/**
 * Load and validate API configuration from environment variables
 *
 * @returns Validated configuration object
 * @throws Exits process with code 1 on validation failure
 */
export function loadConfig(): ApiConfig {
  return loadAndValidateConfig(
    apiConfigSchema,
    {
      port: process.env.PORT,
      host: process.env.HOST,
      logLevel: process.env.LOG_LEVEL,
      requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
      bodyLimit: process.env.BODY_LIMIT,
      swaggerEnabled: process.env.SWAGGER_ENABLED,
      nodeEnv: process.env.NODE_ENV,
    },
    { serviceName: "outboxy-api" },
  );
}
