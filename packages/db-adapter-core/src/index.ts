/**
 * @outboxy/db-adapter-core
 *
 * Core interfaces and types for Outboxy database adapters.
 * This package defines the contract that all database adapters must implement.
 *
 * ## Adapter Convention
 *
 * Each adapter package should export:
 * 1. A class implementing `DatabaseAdapter`
 * 2. A factory function (e.g., `createPostgresAdapter`)
 * 3. A `canHandle(connectionString: string): boolean` function for connection string detection
 *
 * The `canHandle` function allows consumers to detect which adapter to use:
 * ```typescript
 * import { canHandle as canHandlePostgres } from "@outboxy/db-adapter-postgres";
 * import { canHandle as canHandleMySql } from "@outboxy/db-adapter-mysql";
 *
 * if (canHandleMySql(connectionString)) {
 *   // Use MySQL adapter
 * } else if (canHandlePostgres(connectionString)) {
 *   // Use PostgreSQL adapter
 * }
 * ```
 *
 * @example
 * ```typescript
 * import type { DatabaseAdapter, EventRepository } from "@outboxy/db-adapter-core";
 *
 * // Implement a custom adapter
 * class MyDatabaseAdapter implements DatabaseAdapter {
 *   // ...implementation
 * }
 *
 * // Export canHandle for connection string detection
 * export function canHandle(connectionString: string): boolean {
 *   return connectionString.startsWith("mydb://");
 * }
 * ```
 */

export type { EventRepository } from "./interfaces/event-repository.js";
export type { EventService } from "./interfaces/event-service.js";
export type { MaintenanceOperations } from "./interfaces/maintenance.js";
export type { ConnectionManager } from "./interfaces/connection.js";
export type { DatabaseAdapter } from "./interfaces/database-adapter.js";
export type {
  ErrorMapper,
  DatabaseErrorCode,
} from "./interfaces/error-mapper.js";
export type { InboxRepository } from "./interfaces/inbox-repository.js";

export { type Logger, noopLogger } from "./logger.js";

export type {
  OutboxEvent,
  OutboxEventRow,
  InboxEvent,
  InboxEventRow,
  InboxEventInput,
  InboxResult,
  BackoffConfig,
  CreateEventInput,
  EventServiceResult,
  ReplayEventResult,
  ReplayRangeInput,
  ReplayRangeResult,
  ConnectionHealthStatus,
} from "./types.js";

export {
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
  createWithErrorMapping,
  type ErrorMapperFn,
} from "./errors.js";

export {
  detectDatabaseType,
  isDetectionSuccess,
  type AdapterDetector,
  type DatabaseType,
  type DetectionResult,
  type DetectionSuccess,
  type DetectionFailure,
  type DetectorMap,
} from "./adapter-detection.js";
