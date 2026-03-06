import { z } from "zod";
import {
  DESTINATION_TYPE,
  type DestinationType,
  type InboxEventStatus,
} from "./status.js";

/**
 * Zod schema for event creation input
 *
 * Used by both SDK and API for validation.
 */
export const CreateEventInputSchema = z.object({
  aggregateType: z.string().min(1).max(255),
  aggregateId: z.string().min(1).max(255),
  eventType: z.string().min(1).max(255),
  eventVersion: z.number().int().positive().default(1),
  payload: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.unknown()).default({}),
  destinationUrl: z.string().url().max(1000),
  destinationType: z
    .enum([
      DESTINATION_TYPE.HTTP,
      DESTINATION_TYPE.KAFKA,
      DESTINATION_TYPE.SQS,
      DESTINATION_TYPE.RABBITMQ,
      DESTINATION_TYPE.PUBSUB,
    ])
    .default(DESTINATION_TYPE.HTTP),
  idempotencyKey: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9_\-.:/]+$/)
    .optional(),
  maxRetries: z.number().int().min(0).max(100).default(5),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

/**
 * Outbox event as stored in database (camelCase interface)
 */
export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  headers: unknown;
  destinationUrl: string;
  destinationType: DestinationType;
  idempotencyKey: string | null;
  status: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  backoffMultiplier: string | null;
  lastError: string | null;
  errorDetails: unknown;
  createdAt: Date;
  updatedAt: Date;
  processingStartedAt: Date | null;
  processedAt: Date | null;
  metadata: unknown;
  processedByWorker: string | null;
  deletedAt: Date | null;
  createdDate: Date;
}

/**
 * Database row structure (snake_case)
 *
 * Maps to the actual database column names.
 */
export interface OutboxEventRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  headers: unknown;
  destination_url: string;
  destination_type: string;
  idempotency_key: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  next_retry_at: Date | null;
  backoff_multiplier: string | null;
  last_error: string | null;
  error_details: unknown;
  created_at: Date;
  updated_at: Date;
  processing_started_at: Date | null;
  processed_at: Date | null;
  metadata: unknown;
  processed_by_worker: string | null;
  deleted_at: Date | null;
  created_date: Date;
}

/**
 * Map database row (snake_case) to domain model (camelCase)
 */
export function mapRowToEvent(row: OutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    headers: row.headers,
    destinationUrl: row.destination_url,
    destinationType: row.destination_type as DestinationType,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at,
    backoffMultiplier: row.backoff_multiplier,
    lastError: row.last_error,
    errorDetails: row.error_details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processingStartedAt: row.processing_started_at,
    processedAt: row.processed_at,
    metadata: row.metadata,
    processedByWorker: row.processed_by_worker,
    deletedAt: row.deleted_at,
    createdDate: row.created_date,
  };
}

/**
 * Zod schema for inbox receive input
 *
 * Used by SDK for validation. idempotencyKey is REQUIRED for inbox.
 */
export const InboxEventInputSchema = z.object({
  idempotencyKey: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9_\-.:/]+$/),
  aggregateType: z.string().min(1).max(255),
  aggregateId: z.string().min(1).max(255),
  eventType: z.string().min(1).max(255),
  payload: z.record(z.string(), z.unknown()),
  source: z.string().max(255).optional(),
  eventVersion: z.number().int().positive().default(1),
  headers: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type InboxEventInput = z.infer<typeof InboxEventInputSchema>;

/**
 * Inbox event as stored in database (camelCase interface)
 */
export interface InboxEvent {
  id: string;
  idempotencyKey: string;
  source: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  headers: unknown;
  metadata: unknown;
  status: InboxEventStatus;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

/**
 * Inbox database row structure (snake_case)
 *
 * Maps to the actual database column names.
 */
export interface InboxEventRow {
  id: string;
  idempotency_key: string;
  source: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  headers: unknown;
  metadata: unknown;
  status: string;
  error: string | null;
  received_at: Date;
  processed_at: Date | null;
}

/**
 * Result of inbox.receive() operation
 */
export interface InboxResult {
  eventId: string | null;
  status: "processed" | "duplicate";
}

/**
 * Map database row (snake_case) to domain model (camelCase)
 */
export function mapRowToInboxEvent(row: InboxEventRow): InboxEvent {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    headers: row.headers,
    metadata: row.metadata,
    status: row.status as InboxEventStatus,
    error: row.error,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
  };
}
