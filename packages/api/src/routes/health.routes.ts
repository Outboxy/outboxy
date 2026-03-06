import type { FastifyPluginAsync } from "fastify";
import {
  livenessHandler,
  readinessHandler,
} from "../handlers/health.handlers.js";

/**
 * Health check routes
 *
 * - GET /health - Liveness probe (simple)
 * - GET /ready - Readiness probe (checks DB)
 */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Liveness probe
  fastify.get("/health", {
    schema: {
      tags: ["health"],
      summary: "Liveness probe",
      description:
        "Simple health check for Kubernetes liveness probes. Returns 200 if the server is running.",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok"] },
            timestamp: { type: "string", format: "date-time" },
            version: { type: "string" },
          },
          required: ["status", "timestamp"],
        },
      },
    },
    handler: livenessHandler,
  });

  // Readiness probe
  fastify.get("/ready", {
    schema: {
      tags: ["health"],
      summary: "Readiness probe",
      description:
        "Checks database connectivity for Kubernetes readiness probes. Returns 503 if database is unavailable.",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok"] },
            timestamp: { type: "string", format: "date-time" },
            database: {
              type: "object",
              properties: {
                healthy: { type: "boolean" },
                totalConnections: { type: "number" },
                idleConnections: { type: "number" },
                waitingClients: { type: "number" },
              },
            },
          },
        },
        503: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["unhealthy"] },
            timestamp: { type: "string", format: "date-time" },
            database: {
              type: "object",
              properties: {
                healthy: { type: "boolean" },
                error: { type: "string" },
                totalConnections: { type: "number" },
                idleConnections: { type: "number" },
                waitingClients: { type: "number" },
              },
            },
          },
        },
      },
    },
    handler: readinessHandler,
  });
};

export default healthRoutes;
