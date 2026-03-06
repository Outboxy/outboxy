import type { FastifyPluginAsync } from "fastify";
import healthRoutes from "./health.routes.js";
import eventsRoutes from "./events.routes.js";
import adminRoutes from "./admin.routes.js";

/**
 * Route aggregator
 *
 * Registers all API routes on the Fastify instance.
 * Routes are registered without prefix here - the prefix is applied by the caller.
 */
const routes: FastifyPluginAsync = async (fastify) => {
  // Health check routes (no prefix)
  await fastify.register(healthRoutes);

  // Event routes
  await fastify.register(eventsRoutes, { prefix: "/events" });

  // Admin routes
  await fastify.register(adminRoutes, { prefix: "/admin" });
};

export default routes;
