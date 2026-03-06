import type { AdapterFn } from "../types.js";

// Minimal type to avoid requiring @types/pg at compile time
interface PgPoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Pre-built adapter for the `pg` driver
 *
 * @example
 * ```typescript
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { createPgAdapter } from '@outboxy/sdk/adapters';
 *
 * const outboxy = new OutboxyClient({
 *   adapter: createPgAdapter(),
 *   dialect: new PostgreSqlDialect(),
 * });
 * ```
 */
export function createPgAdapter(): AdapterFn<PgPoolClient> {
  return (client) => async (sql, params) => {
    const result = await client.query(sql, params);
    return result.rows as { id: string }[];
  };
}
