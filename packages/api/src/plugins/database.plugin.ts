import type { FastifyPluginAsync } from "fastify";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import fp from "fastify-plugin";

// Type augmentation is in types/fastify.d.ts

interface DatabasePluginOptions {
  /**
   * Database adapter instance (required)
   *
   * Create this from @outboxy/db-adapter-postgres or @outboxy/db-adapter-mysql.
   * Caller is responsible for adapter lifecycle including shutdown.
   */
  adapter: DatabaseAdapter;
}

/**
 * Database adapter plugin
 *
 * Injects DatabaseAdapter as fastify decorator.
 * Caller manages adapter lifecycle (no shutdown hook).
 */
const databasePlugin: FastifyPluginAsync<DatabasePluginOptions> = async (
  fastify,
  options,
) => {
  // Decorate fastify instance with adapter
  fastify.decorate("adapter", options.adapter);
};

export default fp(databasePlugin, {
  name: "database",
  fastify: "5.x",
});
