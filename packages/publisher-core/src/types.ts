import type { OutboxEvent } from "@outboxy/schema";

/**
 * Result of a publish operation
 */
export interface PublishResult {
  success: boolean;
  error?: Error;
  /**
   * Whether the error is retryable
   * - true: Worker will retry with exponential backoff (network errors, 5xx, timeouts)
   * - false: Worker will move event to DLQ (4xx client errors, auth failures)
   */
  retryable: boolean;
  /** Per-publish timing from the publisher (ms) */
  durationMs?: number;
}

/**
 * Abstract publisher interface
 *
 * All publisher implementations (HTTP, Kafka, SQS, RabbitMQ, etc.) must implement this interface.
 * The worker depends ONLY on this interface, never on concrete implementations.
 */
export interface Publisher {
  /**
   * Publish events to destination(s)
   *
   * For HTTP: Groups events by destination URL and sends batch payloads.
   * For Kafka: Sends all events to the configured topic.
   *
   * @param events - Array of events to publish
   * @returns Map of event ID to publish result
   */
  publish(events: OutboxEvent[]): Promise<Map<string, PublishResult>>;

  /**
   * Optional lifecycle hook called when worker starts
   */
  initialize?(): Promise<void>;

  /**
   * Optional lifecycle hook called when worker stops
   */
  shutdown?(): Promise<void>;
}

export type { OutboxEvent };
