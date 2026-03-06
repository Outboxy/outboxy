import type { AdapterFn } from "../types.js";
import type { PoolConnection } from "mysql2/promise";

/**
 * Pre-built adapter for the `mysql2` driver
 *
 * Handles both SELECT queries (returning arrays) and write operations
 * (returning ResultSetHeader with affectedRows).
 *
 * @example
 * ```typescript
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { createMysql2Adapter } from '@outboxy/sdk/adapters';
 *
 * const outboxy = new OutboxyClient({
 *   adapter: createMysql2Adapter(),
 *   dialect: new MySqlDialect(),
 * });
 * ```
 */
export function createMysql2Adapter(): AdapterFn<PoolConnection> {
  return (conn) => async (sql, params) => {
    const [result] = await conn.execute(sql, params);
    if (!Array.isArray(result)) {
      return (result as { affectedRows: number }).affectedRows > 0
        ? [{ id: "" }]
        : [];
    }
    return result as { id: string }[];
  };
}
