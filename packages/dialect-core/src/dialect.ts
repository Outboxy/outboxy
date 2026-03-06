/**
 * SQL dialect interface for database-specific SQL generation
 *
 * This package defines the contract for SQL dialect implementations.
 * Implementations live in separate packages (@outboxy/dialect-postgres, etc.)
 * for tree-shaking and independent versioning.
 */
/**
 * Shared properties for all SQL dialects (outbox and inbox)
 */
export interface BaseDialectProperties {
  /** Dialect identifier */
  readonly name: "postgresql" | "mysql";

  /** Generate placeholder for parameter at index (1-based) */
  placeholder(index: number): string;

  /** Maximum parameters per query */
  readonly maxParameters: number;

  /** Whether database supports RETURNING clause */
  readonly supportsReturning: boolean;
}

export interface SqlDialect extends BaseDialectProperties {
  /**
   * Generate INSERT with idempotency handling
   */
  buildInsert(params: BuildInsertParams): SqlStatement;

  /**
   * Generate bulk INSERT for multiple events
   *
   * **Note:** Bulk inserts do NOT support idempotency keys.
   * If you need idempotency, use individual `buildInsert()` calls.
   */
  buildBulkInsert(params: BuildBulkInsertParams): SqlStatement;
}

export interface BuildInsertParams {
  columns: string[];
  values: unknown[];
  /** Pre-generated ID for databases without RETURNING */
  generatedId?: string;
}

export interface BuildBulkInsertParams {
  columns: string[];
  rows: unknown[][];
  /** Pre-generated IDs for databases without RETURNING */
  generatedIds?: string[];
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export type DialectName = SqlDialect["name"];

/**
 * SQL dialect interface for inbox-specific operations
 *
 * Inbox has different ON CONFLICT semantics than outbox:
 * - Outbox: partial unique index, key reusable after success
 * - Inbox: full unique constraint, permanent dedup
 */
export interface InboxSqlDialect extends BaseDialectProperties {
  /**
   * Generate INSERT with ON CONFLICT DO NOTHING for inbox dedup
   *
   * PostgreSQL: ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
   * MySQL: INSERT IGNORE INTO ... (check affectedRows for duplicate)
   */
  buildInboxInsert(params: BuildInboxInsertParams): SqlStatement;

  /**
   * Generate bulk INSERT for receiveBatch()
   *
   * Handles partial duplicates - some events may be new, some may be duplicates.
   * Returns results indicate which were processed vs duplicate.
   */
  buildInboxBulkInsert(params: BuildInboxBulkInsertParams): SqlStatement;

  /**
   * Generate UPDATE to mark an inbox event as failed
   */
  buildMarkFailed(params: { eventId: string; error: string }): SqlStatement;

  /**
   * Generate SELECT to find inbox events by idempotency keys
   *
   * Used by bulkInsert() to map idempotency keys back to database IDs
   * for duplicate detection after an INSERT ... ON CONFLICT DO NOTHING.
   */
  buildFindByIdempotencyKeys(
    params: BuildFindByIdempotencyKeysParams,
  ): SqlStatement;

  /** Generate DELETE to clean up processed inbox events older than retention period */
  buildCleanupProcessedEvents(
    params: BuildCleanupProcessedEventsParams,
  ): SqlStatement;
}

export interface BuildInboxInsertParams {
  columns: string[];
  values: unknown[];
  /** Pre-generated ID for MySQL (required since no RETURNING) */
  generatedId?: string;
}

export interface BuildInboxBulkInsertParams {
  columns: string[];
  rows: unknown[][];
  /** Pre-generated IDs for MySQL (required since no RETURNING) */
  generatedIds?: string[];
}

export interface BuildFindByIdempotencyKeysParams {
  keys: string[];
}

export interface BuildCleanupProcessedEventsParams {
  retentionDays: number;
}
