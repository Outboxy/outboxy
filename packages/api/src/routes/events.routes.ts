import type { FastifyPluginAsync } from "fastify";
import { getEventStatusHandler } from "../handlers/events.handlers.js";
import {
  getEventParamsSchema,
  eventStatusResponseSchema,
} from "../schemas/event.schemas.js";
import { errorResponseSchema, zodToFastifySchema } from "../schemas/index.js";

/**
 * Event routes
 *
 * - GET /events/:id - Get event status
 *
 * Note: Event creation is done via SDK (direct DB insert in transaction)
 * for true atomicity with business logic. See @outboxy/sdk.
 */
const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /events/:id - Get event status
  fastify.get<{ Params: { id: string } }>("/:id", {
    schema: {
      tags: ["events"],
      summary: "Get event status and details",
      description:
        "Returns full details of an event including its current processing status, retry count, and any errors.",
      params: zodToFastifySchema(getEventParamsSchema),
      response: {
        200: zodToFastifySchema(eventStatusResponseSchema),
        404: {
          description: "Event not found",
          ...zodToFastifySchema(errorResponseSchema),
        },
      },
    },
    handler: getEventStatusHandler,
  });
};

export default eventsRoutes;
