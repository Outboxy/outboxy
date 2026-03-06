import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * GET /health - Liveness probe
 *
 * Simple check that the server is running.
 * Used by Kubernetes for liveness probes.
 */
export async function livenessHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.send({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
  });
}

/**
 * GET /ready - Readiness probe
 *
 * Checks database connectivity.
 * Used by Kubernetes for readiness probes.
 */
export async function readinessHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const health = await request.server.adapter.checkHealth();

  if (health.healthy) {
    reply.send({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: {
        healthy: true,
        totalConnections: health.totalConnections,
        idleConnections: health.idleConnections,
        waitingClients: health.waitingClients,
      },
    });
  } else {
    reply.status(503).send({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      database: {
        healthy: false,
        error: health.error,
        totalConnections: health.totalConnections,
        idleConnections: health.idleConnections,
        waitingClients: health.waitingClients,
      },
    });
  }
}
