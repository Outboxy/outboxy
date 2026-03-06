/**
 * @outboxy/db-adapter-postgres
 *
 * PostgreSQL database adapter for Outboxy.
 * Implements the DatabaseAdapter interface from @outboxy/db-adapter-core.
 *
 * @example
 * ```typescript
 * import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
 *
 * const adapter = await createPostgresAdapter({
 *   connectionString: process.env.DATABASE_URL!,
 *   maxConnections: 20,
 * });
 *
 * // Use in worker
 * const events = await adapter.eventRepository.claimPendingEvents(10);
 *
 * // Use in API
 * const event = await adapter.eventService.createEvent({ ... });
 *
 * // Graceful shutdown
 * await adapter.shutdown();
 * ```
 */

// Main adapter class
export { PostgresAdapter } from "./postgres-adapter.js";

// Config types and schema
export type { PostgresAdapterConfig, Logger } from "./config.js";
export { PostgresAdapterConfigSchema, noopLogger } from "./config.js";

// Factory function (convenience)
import { PostgresAdapter } from "./postgres-adapter.js";
import type { PostgresAdapterConfig } from "./config.js";

export async function createPostgresAdapter(
  config: PostgresAdapterConfig,
): Promise<PostgresAdapter> {
  const adapter = new PostgresAdapter(config);
  await adapter.initialize();
  return adapter;
}

/**
 * Check if this adapter can handle the given connection string
 */
export function canHandle(connectionString: string): boolean {
  const url = connectionString.toLowerCase();
  return (
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    url.includes("host=") // libpq-style
  );
}

// Re-export errors for convenience
export {
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
  mapPostgresError,
  withErrorMapping,
} from "./errors.js";

// Re-export types from core for convenience
export type {
  DatabaseAdapter,
  EventRepository,
  EventService,
  MaintenanceOperations,
  ConnectionManager,
  InboxRepository,
  InboxEventInput,
  InboxResult,
  BackoffConfig,
  CreateEventInput,
  EventServiceResult,
  ReplayEventResult,
  ReplayRangeInput,
  ReplayRangeResult,
  ConnectionHealthStatus,
  OutboxEvent,
  InboxEvent,
} from "@outboxy/db-adapter-core";

// Inbox repository
export { PgInboxRepository } from "./repositories/pg-inbox.repository.js";
