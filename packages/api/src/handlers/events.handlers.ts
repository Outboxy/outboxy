import type { FastifyRequest, FastifyReply } from "fastify";
import type { GetEventParams } from "../schemas/event.schemas.js";
import { NotFoundError } from "../errors.js";

/**
 * GET /events/:id - Get event status and details
 *
 * Returns full event details including processing status.
 */
export async function getEventStatusHandler(
  request: FastifyRequest<{ Params: GetEventParams }>,
  reply: FastifyReply,
): Promise<void> {
  const eventService = request.server.adapter.eventService;
  const { id } = request.params;

  const event = await eventService.getEventById(id);

  if (!event) {
    throw new NotFoundError(`Event not found: ${id}`);
  }

  reply.send({
    id: event.id,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    payload: event.payload,
    headers: event.headers,
    destinationUrl: event.destinationUrl,
    destinationType: event.destinationType,
    idempotencyKey: event.idempotencyKey,
    status: event.status,
    retryCount: event.retryCount,
    maxRetries: event.maxRetries,
    nextRetryAt: event.nextRetryAt?.toISOString() ?? null,
    lastError: event.lastError,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    processingStartedAt: event.processingStartedAt?.toISOString() ?? null,
    processedAt: event.processedAt?.toISOString() ?? null,
  });
}
