import { z } from "zod";

/**
 * Standard API error response schema
 */
export const errorResponseSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * UUID validation schema
 */
export const uuidSchema = z.string().uuid();

/**
 * Pagination query parameters
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Date range schema for filtering
 *
 * Uses ISO 8601 date-time strings for JSON Schema compatibility.
 */
export const dateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * Event status enum values
 */
export const eventStatusEnum = z.enum([
  "pending",
  "processing",
  "succeeded",
  "failed",
  "dlq",
  "cancelled",
]);

export type EventStatus = z.infer<typeof eventStatusEnum>;

/**
 * Destination type enum values
 */
export const destinationTypeEnum = z.enum([
  "http",
  "kafka",
  "sqs",
  "rabbitmq",
  "pubsub",
]);

export type DestinationType = z.infer<typeof destinationTypeEnum>;
