/**
 * Table and column name constants
 *
 * These MUST match the actual database schema. Any schema migration
 * that renames columns must update these constants.
 */
export const TABLE = {
  OUTBOX_EVENTS: "outbox_events",
  OUTBOX_CONFIG: "outbox_config",
  INBOX_EVENTS: "inbox_events",
} as const;

export const COLUMNS = {
  ID: "id",
  AGGREGATE_TYPE: "aggregate_type",
  AGGREGATE_ID: "aggregate_id",
  EVENT_TYPE: "event_type",
  EVENT_VERSION: "event_version",
  PAYLOAD: "payload",
  HEADERS: "headers",
  DESTINATION_URL: "destination_url",
  DESTINATION_TYPE: "destination_type",
  IDEMPOTENCY_KEY: "idempotency_key",
  STATUS: "status",
  RETRY_COUNT: "retry_count",
  MAX_RETRIES: "max_retries",
  NEXT_RETRY_AT: "next_retry_at",
  BACKOFF_MULTIPLIER: "backoff_multiplier",
  LAST_ERROR: "last_error",
  ERROR_DETAILS: "error_details",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  PROCESSING_STARTED_AT: "processing_started_at",
  PROCESSED_AT: "processed_at",
  METADATA: "metadata",
  PROCESSED_BY_WORKER: "processed_by_worker",
  DELETED_AT: "deleted_at",
  CREATED_DATE: "created_date",
} as const;

export const INBOX_COLUMNS = {
  ID: "id",
  IDEMPOTENCY_KEY: "idempotency_key",
  SOURCE: "source",
  AGGREGATE_TYPE: "aggregate_type",
  AGGREGATE_ID: "aggregate_id",
  EVENT_TYPE: "event_type",
  EVENT_VERSION: "event_version",
  PAYLOAD: "payload",
  HEADERS: "headers",
  METADATA: "metadata",
  STATUS: "status",
  ERROR: "error",
  RECEIVED_AT: "received_at",
  PROCESSED_AT: "processed_at",
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];
export type ColumnName = (typeof COLUMNS)[keyof typeof COLUMNS];
export type InboxColumnName =
  (typeof INBOX_COLUMNS)[keyof typeof INBOX_COLUMNS];
