/**
 * @outboxy/db-adapter-mysql
 *
 * MySQL database adapter for Outboxy worker and API.
 *
 * @example
 * ```typescript
 * import { createMySQLAdapter } from "@outboxy/db-adapter-mysql";
 *
 * const adapter = await createMySQLAdapter({
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
export { MySQLAdapter } from "./mysql-adapter.js";

// Config types and schema
export type { MySQLAdapterConfig, Logger } from "./config.js";
export { MySQLAdapterConfigSchema, noopLogger } from "./config.js";

// Factory function (convenience)
import { MySQLAdapter } from "./mysql-adapter.js";
import type { MySQLAdapterConfig } from "./config.js";

export async function createMySQLAdapter(
  config: MySQLAdapterConfig,
): Promise<MySQLAdapter> {
  const adapter = new MySQLAdapter(config);
  await adapter.initialize();
  return adapter;
}

/**
 * Check if this adapter can handle the given connection string
 */
export function canHandle(connectionString: string): boolean {
  const url = connectionString.toLowerCase();
  return url.startsWith("mysql://") || url.startsWith("mysql2://");
}

// Repository implementations
export { MySQLEventRepository } from "./repositories/mysql-event.repository.js";
export { MySQLEventService } from "./repositories/mysql-event.service.js";
export { MySQLMaintenance } from "./repositories/mysql-maintenance.js";
export { MySqlInboxRepository } from "./repositories/mysql-inbox.repository.js";

// Error handling
export {
  mapMySQLError,
  withErrorMapping,
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
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
