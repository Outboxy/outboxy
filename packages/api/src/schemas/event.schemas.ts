import { z } from "zod";
import { eventStatusEnum, destinationTypeEnum } from "./common.schemas.js";

/**
 * GET /events/:id params schema
 */
export const getEventParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetEventParams = z.infer<typeof getEventParamsSchema>;

/**
 * GET /events/:id response schema (full event details)
 */
export const eventStatusResponseSchema = z.object({
  id: z.string().uuid(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  eventType: z.string(),
  eventVersion: z.number(),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.unknown()),
  destinationUrl: z.string(),
  destinationType: destinationTypeEnum,
  idempotencyKey: z.string().nullable(),
  status: eventStatusEnum,
  retryCount: z.number(),
  maxRetries: z.number(),
  nextRetryAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  processingStartedAt: z.string().datetime().nullable(),
  processedAt: z.string().datetime().nullable(),
});

export type EventStatusResponse = z.infer<typeof eventStatusResponseSchema>;
