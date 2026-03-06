import type { DatabaseAdapter } from "@outboxy/db-adapter-core";

/**
 * Fastify type extensions for Outboxy API
 *
 * Extends FastifyInstance with custom decorators injected by plugins.
 */
declare module "fastify" {
  interface FastifyInstance {
    /**
     * Database adapter for all database operations
     * Injected by database.plugin.ts
     */
    adapter: DatabaseAdapter;
  }
}
