import type { FastifyPluginAsync } from "fastify";
import {
  replayEventHandler,
  replayRangeHandler,
} from "../handlers/admin.handlers.js";
import {
  replayEventParamsSchema,
  replayEventResponseSchema,
  replayRangeBodySchema,
  replayRangeResponseSchema,
} from "../schemas/admin.schemas.js";
import { errorResponseSchema, zodToFastifySchema } from "../schemas/index.js";

/**
 * Admin routes
 *
 * - POST /admin/replay/:id - Replay single event
 * - POST /admin/replay/range - Bulk replay events
 */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /admin/replay/:id - Replay single event
  fastify.post<{ Params: { id: string } }>("/replay/:id", {
    schema: {
      tags: ["admin"],
      summary: "Replay a single event",
      description:
        "Resets a failed or DLQ event back to pending status for reprocessing. The worker will pick it up and attempt delivery again.",
      params: zodToFastifySchema(replayEventParamsSchema),
      response: {
        200: zodToFastifySchema(replayEventResponseSchema),
        404: {
          description: "Event not found",
          ...zodToFastifySchema(errorResponseSchema),
        },
        422: {
          description: "Event cannot be replayed (wrong status)",
          ...zodToFastifySchema(errorResponseSchema),
        },
      },
    },
    handler: replayEventHandler,
  });

  // POST /admin/replay/range - Bulk replay events
  fastify.post("/replay/range", {
    schema: {
      tags: ["admin"],
      summary: "Replay multiple events in a date range",
      description:
        "Bulk replay for failed or DLQ events within a specified time window. Optionally filter by aggregate type. Returns the list of replayed event IDs.",
      body: zodToFastifySchema(replayRangeBodySchema),
      response: {
        200: zodToFastifySchema(replayRangeResponseSchema),
        400: zodToFastifySchema(errorResponseSchema),
      },
    },
    handler: replayRangeHandler,
  });
};

export default adminRoutes;
