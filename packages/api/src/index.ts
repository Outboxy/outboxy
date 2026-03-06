/**
 * Outboxy API Server
 *
 * Fastify-based REST API for admin/observability operations.
 * SDK handles direct DB writes; API provides status checking,
 * replay capabilities, metrics, and health endpoints.
 *
 * @packageDocumentation
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { createLogger } from "@outboxy/logging";
import { loadConfig, type ApiConfig } from "./config.js";
import databasePlugin from "./plugins/database.plugin.js";
import errorHandlerPlugin from "./plugins/error-handler.plugin.js";
import swaggerPlugin from "./plugins/swagger.plugin.js";
import routes from "./routes/index.js";

export interface CreateServerOptions {
  /**
   * Database adapter instance (required)
   *
   * Create this from @outboxy/db-adapter-postgres or @outboxy/db-adapter-mysql.
   * Caller is responsible for adapter lifecycle including shutdown.
   */
  adapter: DatabaseAdapter;
  /**
   * Optional configuration overrides
   *
   * If not provided, configuration is loaded from environment variables.
   */
  config?: Partial<ApiConfig>;
}

/**
 * Create and configure the Fastify server instance
 *
 * @param options - Server options with required adapter
 * @returns Configured Fastify server (not started)
 */
export async function createServer(
  options: CreateServerOptions,
): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...options.config };
  const logger = createLogger({
    service: "outboxy-api",
    level: config.logLevel,
    version: process.env.npm_package_version,
  });

  const server = Fastify({
    loggerInstance: logger,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    disableRequestLogging: config.nodeEnv === "production",
  });

  // Register error handler first (catches all errors)
  await server.register(errorHandlerPlugin);

  // Database adapter (required, caller manages lifecycle)
  await server.register(databasePlugin, { adapter: options.adapter });

  // OpenAPI documentation (conditional)
  await server.register(swaggerPlugin, {
    enabled: config.swaggerEnabled,
  });

  // API routes
  await server.register(routes);

  // Ready route for Swagger UI
  await server.ready();

  // Cast is needed because Fastify with custom logger has a more specific type
  return server as unknown as FastifyInstance;
}

// Re-export types for external use
export type { ApiConfig } from "./config.js";
export { loadConfig } from "./config.js";
