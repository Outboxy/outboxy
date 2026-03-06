import type {
  SqlDialect,
  BuildInsertParams,
  BuildBulkInsertParams,
  SqlStatement,
} from "@outboxy/dialect-core";
import { TABLE, COLUMNS, STATUS } from "@outboxy/schema";

/**
 * PostgreSQL dialect for Outboxy SDK
 *
 * Generates PostgreSQL-specific SQL for event publishing.
 * Uses RETURNING clause for ID retrieval and ON CONFLICT for idempotency.
 */
export class PostgreSqlDialect implements SqlDialect {
  readonly name = "postgresql" as const;
  readonly maxParameters = 65535;
  readonly supportsReturning = true;

  placeholder(index: number): string {
    return `$${index}`;
  }

  buildInsert(params: BuildInsertParams): SqlStatement {
    const placeholders = params.columns.map((_, i) => this.placeholder(i + 1));

    // PostgreSQL ON CONFLICT with partial unique index
    // Only updates if idempotency_key exists AND status is not succeeded
    const sql = `
      INSERT INTO ${TABLE.OUTBOX_EVENTS} (${params.columns.join(", ")})
      VALUES (${placeholders.join(", ")})
      ON CONFLICT (${COLUMNS.IDEMPOTENCY_KEY})
      WHERE ${COLUMNS.IDEMPOTENCY_KEY} IS NOT NULL AND ${COLUMNS.STATUS} != '${STATUS.SUCCEEDED}'
      DO UPDATE SET ${COLUMNS.IDEMPOTENCY_KEY} = ${TABLE.OUTBOX_EVENTS}.${COLUMNS.IDEMPOTENCY_KEY}
      RETURNING ${COLUMNS.ID}
    `;

    return { sql: sql.trim(), params: params.values };
  }

  buildBulkInsert(params: BuildBulkInsertParams): SqlStatement {
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

    const sql = `
      INSERT INTO ${TABLE.OUTBOX_EVENTS} (${params.columns.join(", ")})
      VALUES ${valuesClauses.join(", ")}
      RETURNING ${COLUMNS.ID}
    `;

    return { sql: sql.trim(), params: allParams };
  }
}
