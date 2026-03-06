import type { FastifyPluginAsync } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";

interface SwaggerPluginOptions {
  enabled?: boolean;
}

/**
 * Swagger/OpenAPI documentation plugin
 *
 * Serves OpenAPI spec at /docs and Swagger UI.
 */
const swaggerPlugin: FastifyPluginAsync<SwaggerPluginOptions> = async (
  fastify,
  options,
) => {
  if (options.enabled === false) {
    fastify.log.info("Swagger documentation disabled");
    return;
  }

  await fastify.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Outboxy API",
        description:
          "Transactional Outbox Pattern as a Service - REST API for event management, status monitoring, and administrative operations.",
        version: "0.1.0",
        contact: {
          name: "Outboxy Team",
          url: "https://github.com/outboxy/outboxy",
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT",
        },
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Development server",
        },
      ],
      tags: [
        {
          name: "health",
          description: "Health check endpoints for Kubernetes probes",
        },
        {
          name: "events",
          description: "Event creation and status management",
        },
        {
          name: "admin",
          description: "Administrative operations (replay, bulk actions)",
        },
        {
          name: "metrics",
          description: "Prometheus metrics and observability",
        },
      ],
      components: {
        schemas: {
          ErrorResponse: {
            type: "object",
            properties: {
              statusCode: { type: "number" },
              error: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              details: { type: "object" },
            },
            required: ["statusCode", "error", "message"],
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      defaultModelsExpandDepth: 3,
    },
    staticCSP: true,
  });

  fastify.log.info("Swagger documentation available at /docs");
};

export default fp(swaggerPlugin, {
  name: "swagger",
  fastify: "5.x",
});
