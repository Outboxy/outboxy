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
 * PostgreSQL inbox dialect for Outboxy SDK
 *
 * Generates PostgreSQL-specific SQL for inbox deduplication.
 * Uses ON CONFLICT DO NOTHING for permanent dedup (unlike outbox's partial index).
 */
export class PostgreSqlInboxDialect implements InboxSqlDialect {
  readonly name = "postgresql" as const;
  readonly maxParameters = 65535;
  readonly supportsReturning = true;

  placeholder(index: number): string {
    return `$${index}`;
  }

  buildInboxInsert(params: BuildInboxInsertParams): SqlStatement {
    const placeholders = params.columns.map((_, i) => this.placeholder(i + 1));

    // Inbox uses full unique constraint on idempotency_key
    // ON CONFLICT DO NOTHING for permanent dedup
    // RETURNING id returns null for duplicates
    const sql = `
      INSERT INTO ${TABLE.INBOX_EVENTS} (${params.columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT (${INBOX_COLUMNS.IDEMPOTENCY_KEY}) DO NOTHING
      RETURNING ${INBOX_COLUMNS.ID}
    `;

    return { sql: sql.trim(), params: params.values };
  }

  buildInboxBulkInsert(params: BuildInboxBulkInsertParams): SqlStatement {
    const allParams: unknown[] = [];
    const valuesClauses: string[] = [];

    for (let rowIdx = 0; rowIdx < params.rows.length; rowIdx++) {
      const row = params.rows[rowIdx]!;
      const rowPlaceholders: string[] = [];

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const paramIdx = rowIdx * params.columns.length + colIdx + 1;
        rowPlaceholders.push(this.placeholder(paramIdx));
        allParams.push(row[colIdx]);
      }

      valuesClauses.push(`(${rowPlaceholders.join(", ")})`);
    }

    // Bulk insert with ON CONFLICT DO NOTHING
    // Returns array of IDs for successfully inserted rows, null for duplicates
    const sql = `
      INSERT INTO ${TABLE.INBOX_EVENTS} (${params.columns.join(", ")})
      VALUES ${valuesClauses.join(", ")}
      ON CONFLICT (${INBOX_COLUMNS.IDEMPOTENCY_KEY}) DO NOTHING
      RETURNING ${INBOX_COLUMNS.ID}
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
      sql: `UPDATE ${TABLE.INBOX_EVENTS} SET ${INBOX_COLUMNS.STATUS} = $1, ${INBOX_COLUMNS.ERROR} = $2 WHERE ${INBOX_COLUMNS.ID} = $3`,
      params: [INBOX_STATUS.FAILED, error, eventId],
    };
  }

  buildFindByIdempotencyKeys(
    params: BuildFindByIdempotencyKeysParams,
  ): SqlStatement {
    if (params.keys.length === 0) {
      throw new Error("buildFindByIdempotencyKeys requires at least one key");
    }

    const placeholders = params.keys
      .map((_, i) => this.placeholder(i + 1))
      .join(", ");
    return {
      sql: `SELECT ${INBOX_COLUMNS.ID}, ${INBOX_COLUMNS.IDEMPOTENCY_KEY} FROM ${TABLE.INBOX_EVENTS} WHERE ${INBOX_COLUMNS.IDEMPOTENCY_KEY} IN (${placeholders})`,
      params: params.keys,
    };
  }

  buildCleanupProcessedEvents(
    params: BuildCleanupProcessedEventsParams,
  ): SqlStatement {
    return {
      sql: `DELETE FROM ${TABLE.INBOX_EVENTS} WHERE ${INBOX_COLUMNS.STATUS} = $1 AND ${INBOX_COLUMNS.PROCESSED_AT} < NOW() - ($2 * interval '1 day')`,
      params: [INBOX_STATUS.PROCESSED, params.retentionDays],
    };
  }
}
