/**
 * Failure reason categories for error tracking
 */
export type FailureReason =
  | "timeout"
  | "connection_error"
  | "4xx"
  | "5xx"
  | "kafka_producer"
  | "dlq"
  | "unknown";

/**
 * Standard metric labels for consistent observability
 */
export const METRIC_LABELS = {
  DESTINATION_TYPE: "destination_type",
  EVENT_TYPE: "event_type",
  AGGREGATE_TYPE: "aggregate_type",
  STATUS: "status",
  FAILURE_REASON: "failure_reason",
  RETRY_COUNT: "retry_count",
  WORKER_ID: "worker_id",
} as const;

/**
 * Standard histogram bucket configurations
 */
export const HISTOGRAM_BUCKETS = {
  PROCESSING_SECONDS: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  BATCH_SIZE: [1, 5, 10, 25, 50, 60, 70, 80, 90, 95, 100],
} as const;
