import { z } from "zod";

/**
 * Zod schema for a single webhook event in the batch payload
 *
 * Matches the format sent by the HTTP publisher to webhook endpoints.
 */
export const WebhookEventSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  payload: z.unknown(),
  createdAt: z.iso.datetime(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/**
 * Zod schema for the batch envelope sent by the HTTP publisher
 *
 * The HTTP publisher groups events by destination URL and sends
 * a single HTTP POST with this batch format.
 */
export const WebhookBatchSchema = z
  .object({
    batch: z.literal(true),
    count: z.number().int().nonnegative(),
    events: z.array(WebhookEventSchema),
  })
  .refine((data) => data.count === data.events.length, {
    message: "count must match the number of events",
    path: ["count"],
  });

export type WebhookBatch = z.infer<typeof WebhookBatchSchema>;
