import { z } from "zod";
import { eventStatusEnum } from "./common.schemas.js";

/**
 * POST /admin/replay/:id params schema
 */
export const replayEventParamsSchema = z.object({
  id: z.string().uuid(),
});

export type ReplayEventParams = z.infer<typeof replayEventParamsSchema>;

/**
 * POST /admin/replay/:id response schema
 */
export const replayEventResponseSchema = z.object({
  id: z.string().uuid(),
  previousStatus: eventStatusEnum,
  newStatus: z.literal("pending"),
  replayedAt: z.string().datetime(),
});

export type ReplayEventResponse = z.infer<typeof replayEventResponseSchema>;

/**
 * POST /admin/replay/range request body schema
 *
 * Uses ISO 8601 date-time strings for JSON Schema compatibility.
 */
export const replayRangeBodySchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    status: z.enum(["failed", "dlq"]).optional().default("dlq"),
    aggregateType: z.string().max(255).optional(),
    limit: z.number().int().positive().max(1000).default(100),
  })
  .refine((data) => new Date(data.startDate) < new Date(data.endDate), {
    message: "startDate must be before endDate",
  });

export type ReplayRangeBody = z.infer<typeof replayRangeBodySchema>;

/**
 * POST /admin/replay/range response schema
 */
export const replayRangeResponseSchema = z.object({
  replayedCount: z.number(),
  eventIds: z.array(z.string().uuid()),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: z.string(),
});

export type ReplayRangeResponse = z.infer<typeof replayRangeResponseSchema>;
