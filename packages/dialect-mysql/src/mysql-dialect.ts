import type {
  SqlDialect,
  BuildInsertParams,
  BuildBulkInsertParams,
  SqlStatement,
} from "@outboxy/dialect-core";
import { TABLE, COLUMNS, STATUS } from "@outboxy/schema";

/**
 * MySQL dialect for Outboxy SDK
 *
 * Generates MySQL-specific SQL for event publishing.
 * Requires pre-generated UUIDs since MySQL doesn't support RETURNING.
 *
 * Note: MySQL doesn't support conditional unique indexes like PostgreSQL.
 * The SDK handles idempotency behavior differences at runtime.
 */
export class MySqlDialect implements SqlDialect {
  readonly name = "mysql" as const;
  readonly maxParameters = 65535;
  readonly supportsReturning = false;

  placeholder(_index: number): string {
    return "?";
  }

  buildInsert(params: BuildInsertParams): SqlStatement {
    if (!params.generatedId) {
      throw new Error(
        "MySQL requires generatedId for INSERT (no RETURNING support)",
      );
    }

    const placeholders = params.columns.map(() => "?");

    // MySQL ON DUPLICATE KEY UPDATE with conditional logic
    // Only updates retry-related fields if status is not 'succeeded'
    // If status is 'succeeded', the update is a no-op (keeps existing values)
    //
    // Important: MySQL unique constraint is on idempotency_key column.
    // Unlike PostgreSQL, we can't have a partial unique index.
    // The SDK layer handles checking for succeeded events.
    const sql = `
      INSERT INTO ${TABLE.OUTBOX_EVENTS} (${params.columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON DUPLICATE KEY UPDATE
        ${COLUMNS.UPDATED_AT} = CASE
          WHEN ${COLUMNS.STATUS} != '${STATUS.SUCCEEDED}'
          THEN NOW()
          ELSE ${COLUMNS.UPDATED_AT}
        END
    `;

    return { sql: sql.trim(), params: params.values };
  }

  buildBulkInsert(params: BuildBulkInsertParams): SqlStatement {
    if (
      !params.generatedIds ||
      params.generatedIds.length !== params.rows.length
    ) {
      throw new Error("MySQL requires generatedIds for bulk INSERT");
    }

    const allParams: unknown[] = [];
    const valuesClauses: string[] = [];

    for (const row of params.rows) {
      const rowPlaceholders = row.map(() => "?");
      valuesClauses.push(`(${rowPlaceholders.join(", ")})`);
      allParams.push(...row);
    }

    // Bulk insert without idempotency handling (batch inserts typically don't use idempotency keys)
    const sql = `
      INSERT INTO ${TABLE.OUTBOX_EVENTS} (${params.columns.join(", ")})
      VALUES ${valuesClauses.join(", ")}
    `;

    return { sql: sql.trim(), params: allParams };
  }
}
