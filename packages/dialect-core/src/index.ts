/**
 * @outboxy/dialect-core
 *
 * Core SQL dialect interface for Outboxy database abstraction.
 * This package defines the contract for database-specific SQL generation.
 */

export type {
  BaseDialectProperties,
  SqlDialect,
  BuildInsertParams,
  BuildBulkInsertParams,
  SqlStatement,
  DialectName,
  InboxSqlDialect,
  BuildInboxInsertParams,
  BuildInboxBulkInsertParams,
  BuildFindByIdempotencyKeysParams,
  BuildCleanupProcessedEventsParams,
} from "./dialect.js";
