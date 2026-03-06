import type {
  InboxSqlDialect,
  BuildInboxInsertParams,
  BuildInboxBulkInsertParams,
  BuildFindByIdempotencyKeysParams,
  BuildCleanupProcessedEventsParams,
  SqlStatement,
} from "@outboxy/dialect-core";
import { TABLE, INBOX_COLUMNS, INBOX_STATUS } from "@outboxy/schema";

/**
 * MySQL inbox dialect for Outboxy SDK
 *
 * Generates MySQL-specific SQL for inbox deduplication.
 * Uses INSERT IGNORE for dedup (check affectedRows for duplicate detection).
 * Requires pre-generated UUIDs since MySQL doesn't support RETURNING.
 */
export class MySqlInboxDialect implements InboxSqlDialect {
  readonly name = "mysql" as const;
  readonly maxParameters = 65535;
  readonly supportsReturning = false;

  placeholder(_index: number): string {
    return "?";
  }

  buildInboxInsert(params: BuildInboxInsertParams): SqlStatement {
    if (!params.generatedId) {
      throw new Error(
        "MySQL requires generatedId for inbox INSERT (no RETURNING support)",
      );
    }

    const placeholders = params.columns.map(() => "?");

    // INSERT IGNORE silently ignores rows that would cause duplicate key errors
    // Check affectedRows (0 = duplicate, 1 = inserted)
    const sql = `
      INSERT IGNORE INTO ${TABLE.INBOX_EVENTS} (${params.columns.join(", ")})
      VALUES (${placeholders.join(", ")})
    `;

    return { sql: sql.trim(), params: params.values };
  }

  buildInboxBulkInsert(params: BuildInboxBulkInsertParams): SqlStatement {
    if (
      !params.generatedIds ||
      params.generatedIds.length !== params.rows.length
    ) {
      throw new Error("MySQL requires generatedIds for bulk inbox INSERT");
    }

    const allParams: unknown[] = [];
    const valuesClauses: string[] = [];

    for (const row of params.rows) {
      const rowPlaceholders = row.map(() => "?");
      valuesClauses.push(`(${rowPlaceholders.join(", ")})`);
      allParams.push(...row);
    }

    // INSERT IGNORE for bulk - check affectedRows to count how many were inserted
    // Note: This doesn't tell you WHICH rows were duplicates, just the count
    // For individual duplicate detection, use single inserts
    const sql = `
      INSERT IGNORE INTO ${TABLE.INBOX_EVENTS} (${params.columns.join(", ")})
      VALUES ${valuesClauses.join(", ")}
    `;

    return { sql: sql.trim(), params: allParams };
  }

  buildMarkFailed({
    eventId,
    error,
  }: {
    eventId: string;
    error: string;
  }): SqlStatement {
    return {
      sql: `UPDATE ${TABLE.INBOX_EVENTS} SET ${INBOX_COLUMNS.STATUS} = ?, ${INBOX_COLUMNS.ERROR} = ? WHERE ${INBOX_COLUMNS.ID} = ?`,
      params: [INBOX_STATUS.FAILED, error, eventId],
    };
  }

  buildFindByIdempotencyKeys(
    params: BuildFindByIdempotencyKeysParams,
  ): SqlStatement {
    if (params.keys.length === 0) {
      throw new Error("buildFindByIdempotencyKeys requires at least one key");
    }

    const placeholders = params.keys.map(() => "?").join(", ");
    return {
      sql: `SELECT ${INBOX_COLUMNS.ID}, ${INBOX_COLUMNS.IDEMPOTENCY_KEY} FROM ${TABLE.INBOX_EVENTS} WHERE ${INBOX_COLUMNS.IDEMPOTENCY_KEY} IN (${placeholders})`,
      params: params.keys,
    };
  }

  buildCleanupProcessedEvents(
    params: BuildCleanupProcessedEventsParams,
  ): SqlStatement {
    return {
      sql: `DELETE FROM ${TABLE.INBOX_EVENTS} WHERE ${INBOX_COLUMNS.STATUS} = ? AND ${INBOX_COLUMNS.PROCESSED_AT} < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      params: [INBOX_STATUS.PROCESSED, params.retentionDays],
    };
  }
}
