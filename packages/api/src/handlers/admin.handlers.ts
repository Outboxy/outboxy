import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  ReplayEventParams,
  ReplayRangeBody,
} from "../schemas/admin.schemas.js";
import { NotFoundError, InvalidStateError } from "../errors.js";

/**
 * POST /admin/replay/:id - Replay a single event
 *
 * Resets a failed/dlq event to pending status for reprocessing.
 */
export async function replayEventHandler(
  request: FastifyRequest<{ Params: ReplayEventParams }>,
  reply: FastifyReply,
): Promise<void> {
  const eventService = request.server.adapter.eventService;
  const { id } = request.params;

  const result = await eventService.replayEvent(id);

  if (!result) {
    const event = await eventService.getEventById(id);

    if (!event) {
      throw new NotFoundError(`Event not found: ${id}`);
    }

    throw new InvalidStateError(
      `Cannot replay event in '${event.status}' status. Only 'failed' or 'dlq' events can be replayed.`,
    );
  }

  reply.send({
    id: result.id,
    previousStatus: result.previousStatus,
    newStatus: result.newStatus,
    replayedAt: result.replayedAt.toISOString(),
  });
}

/**
 * POST /admin/replay/range - Replay multiple events in a date range
 *
 * Bulk replay for failed/dlq events within a time window.
 */
export async function replayRangeHandler(
  request: FastifyRequest<{ Body: ReplayRangeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const eventService = request.server.adapter.eventService;
  const body = request.body;

  const result = await eventService.replayEventsInRange({
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    status: body.status,
    aggregateType: body.aggregateType,
    limit: body.limit,
  });

  reply.send({
    replayedCount: result.replayedCount,
    eventIds: result.eventIds,
    startDate: body.startDate,
    endDate: body.endDate,
    status: body.status,
  });
}
