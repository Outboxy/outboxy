import type { AdapterFn } from "../types.js";

// postgres-js types - use minimal type definition to avoid requiring the package at compile time
interface PostgresJsSql {
  unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]>;
}

/**
 * Pre-built adapter for the `postgres` (postgres-js) driver
 *
 * Works with both `Sql` and `TransactionSql` from the postgres package.
 *
 * @example
 * ```typescript
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { createPostgresJsAdapter } from '@outboxy/sdk/adapters';
 *
 * const outboxy = new OutboxyClient({
 *   adapter: createPostgresJsAdapter(),
 *   dialect: new PostgreSqlDialect(),
 * });
 * ```
 */
export function createPostgresJsAdapter(): AdapterFn<PostgresJsSql> {
  return (sql) => async (query, params) => {
    const rows = await sql.unsafe(query, params as readonly unknown[]);
    return rows as unknown as { id: string }[];
  };
}
