import type { OutboxEvent } from "@outboxy/schema";
import type {
  CreateEventInput,
  EventServiceResult,
  ReplayEventResult,
  ReplayRangeInput,
  ReplayRangeResult,
} from "../types.js";

/**
 * Service interface for API database operations
 *
 * This interface defines the contract for all database operations used by the
 * REST API. These operations are typically simpler than worker operations
 * but must handle idempotency and soft deletes.
 */
export interface EventService {
  /**
   * Create a new outbox event
   *
   * Inserts event with "pending" status for worker processing.
   * If idempotencyKey is provided and exists, should return existing event.
   *
   * @param input - Event creation parameters
   * @returns Created event info (id, status, createdAt)
   */
  createEvent(input: CreateEventInput): Promise<EventServiceResult>;

  /**
   * Get event by ID
   *
   * Returns full event details including processing state.
   * Should respect soft deletes (return null for deleted events).
   *
   * @param id - Event UUID
   * @returns Full event or null if not found/deleted
   */
  getEventById(id: string): Promise<OutboxEvent | null>;

  /**
   * Find event by idempotency key
   *
   * Used for duplicate prevention during event creation.
   * Only returns non-succeeded events (succeeded events free up the key).
   *
   * @param key - Idempotency key to search for
   * @returns Event info if found, null otherwise
   */
  findByIdempotencyKey(key: string): Promise<EventServiceResult | null>;

  /**
   * Replay a single failed/dlq event
   *
   * Resets event to "pending" status for reprocessing.
   * Only works for events in "failed" or "dlq" status.
   *
   * @param id - Event UUID to replay
   * @returns Replay result or null if event not found/wrong status
   */
  replayEvent(id: string): Promise<ReplayEventResult | null>;

  /**
   * Replay multiple events within a date range
   *
   * Bulk operation to reset failed/dlq events to pending.
   * Respects optional filters (status, aggregateType, limit).
   *
   * @param input - Replay range parameters
   * @returns Number of events replayed and their IDs
   */
  replayEventsInRange(input: ReplayRangeInput): Promise<ReplayRangeResult>;
}
