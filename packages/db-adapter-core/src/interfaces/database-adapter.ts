import type { EventRepository } from "./event-repository.js";
import type { EventService } from "./event-service.js";
import type { MaintenanceOperations } from "./maintenance.js";
import type { ConnectionManager } from "./connection.js";

/**
 * Unified database adapter interface
 *
 * This is the main interface that concrete adapters (PostgreSQL, MySQL, etc.)
 * must implement. It combines all sub-interfaces and provides access to
 * the underlying database client for advanced use cases.
 *
 * @example
 * ```typescript
 * const adapter = await createPostgresAdapter({
 *   connectionString: process.env.DATABASE_URL,
 * });
 *
 * // Use in worker
 * const events = await adapter.eventRepository.claimPendingEvents(10);
 *
 * // Use in API
 * const event = await adapter.eventService.createEvent({ ... });
 *
 * // Background maintenance
 * await adapter.maintenance.recoverStaleEvents(300000);
 *
 * // Graceful shutdown
 * await adapter.shutdown();
 * ```
 */
export interface DatabaseAdapter extends ConnectionManager {
  /**
   * Repository for worker operations (claim, succeed, retry, DLQ)
   */
  readonly eventRepository: EventRepository;

  /**
   * Service for API operations (create, get, replay)
   */
  readonly eventService: EventService;

  /**
   * Maintenance operations (stale recovery, cleanup)
   */
  readonly maintenance: MaintenanceOperations;

  /**
   * Get the underlying database client
   *
   * Returns the native client (e.g., pg.Pool for PostgreSQL).
   * Use for advanced operations not covered by the adapter interfaces.
   *
   * @returns Native database client (type depends on adapter)
   */
  getClient(): unknown;
}
