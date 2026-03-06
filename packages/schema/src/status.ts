/**
 * Event status values
 *
 * These MUST match the CHECK constraint in the database schema.
 */
export const STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  DLQ: "dlq",
  CANCELLED: "cancelled",
} as const;

export type EventStatus = (typeof STATUS)[keyof typeof STATUS];

/**
 * Destination types for event delivery
 */
export const DESTINATION_TYPE = {
  HTTP: "http",
  KAFKA: "kafka",
  SQS: "sqs",
  RABBITMQ: "rabbitmq",
  PUBSUB: "pubsub",
} as const;

export type DestinationType =
  (typeof DESTINATION_TYPE)[keyof typeof DESTINATION_TYPE];

/**
 * Array of all valid statuses (useful for validation)
 */
export const ALL_STATUSES = Object.values(STATUS);

/**
 * Array of all valid destination types (useful for validation)
 */
export const ALL_DESTINATION_TYPES = Object.values(DESTINATION_TYPE);

/**
 * Inbox event status values
 *
 * These MUST match the CHECK constraint in the database schema.
 */
export const INBOX_STATUS = {
  PROCESSED: "processed",
  FAILED: "failed",
} as const;

export type InboxEventStatus = (typeof INBOX_STATUS)[keyof typeof INBOX_STATUS];

/**
 * Array of all valid inbox statuses (useful for validation)
 */
export const ALL_INBOX_STATUSES = Object.values(INBOX_STATUS);
