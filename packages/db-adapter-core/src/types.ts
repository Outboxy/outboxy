/**
 * Core types for Outboxy database adapters
 */

// Re-export canonical types from schema package
export type {
  OutboxEvent,
  OutboxEventRow,
  InboxEvent,
  InboxEventRow,
  InboxEventInput,
  InboxResult,
} from "@outboxy/schema";

/**
 * Configuration for exponential backoff retry logic
 */
export interface BackoffConfig {
  /** Base delay in milliseconds (e.g., 1000ms = 1 second) */
  backoffBaseMs: number;
  /** Multiplier for exponential growth (e.g., 2.0 doubles delay each retry) */
  backoffMultiplier: number;
}

/**
 * Input for creating a new outbox event
 */
export interface CreateEventInput {
  /** Type of aggregate (e.g., "Order", "User") */
  aggregateType: string;
  /** Unique identifier of the aggregate instance */
  aggregateId: string;
  /** Type of event (e.g., "OrderCreated", "UserUpdated") */
  eventType: string;
  /** Version of the event schema (default: 1) */
  eventVersion?: number;
  /** Event payload data */
  payload: Record<string, unknown>;
  /** Optional headers to include with the event */
  headers?: Record<string, unknown>;
  /** Destination URL for HTTP delivery */
  destinationUrl: string;
  /** Destination type (default: "http") */
  destinationType?: string;
  /** Optional idempotency key for duplicate prevention */
  idempotencyKey?: string;
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
  /** Additional metadata (can include tracing info like trace_id, span_id) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of creating an event
 */
export interface EventServiceResult {
  /** Generated event ID */
  id: string;
  /** Current status (always "pending" for new events) */
  status: string;
  /** Timestamp when event was created */
  createdAt: Date;
}

/**
 * Result of replaying a single event
 */
export interface ReplayEventResult {
  /** Event ID that was replayed */
  id: string;
  /** Status before replay (e.g., "failed", "dlq") */
  previousStatus: string;
  /** Status after replay (always "pending") */
  newStatus: string;
  /** Timestamp when replay occurred */
  replayedAt: Date;
}

/**
 * Input for bulk replay operation
 */
export interface ReplayRangeInput {
  /** Start of date range (inclusive) */
  startDate: Date;
  /** End of date range (inclusive) */
  endDate: Date;
  /** Filter by status (default: "dlq") */
  status?: "failed" | "dlq";
  /** Optional filter by aggregate type */
  aggregateType?: string;
  /** Maximum events to replay (default: 100) */
  limit?: number;
}

/**
 * Result of bulk replay operation
 */
export interface ReplayRangeResult {
  /** Number of events successfully replayed */
  replayedCount: number;
  /** IDs of replayed events */
  eventIds: string[];
}

/**
 * Health status of database connection
 */
export interface ConnectionHealthStatus {
  /** Whether the connection is healthy */
  healthy: boolean;
  /** Total number of connections in the pool (optional, not exposed by all drivers) */
  totalConnections?: number;
  /** Number of idle connections available (optional, not exposed by all drivers) */
  idleConnections?: number;
  /** Number of clients waiting for a connection (optional, not exposed by all drivers) */
  waitingClients?: number;
  /** Error message if unhealthy */
  error?: string;
}
