/**
 * @outboxy/dialect-postgres
 *
 * PostgreSQL dialect for Outboxy SDK.
 *
 * @example
 * ```typescript
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { PostgreSqlDialect } from '@outboxy/dialect-postgres';
 *
 * const client = new OutboxyClient({
 *   adapter: myAdapter,
 *   dialect: new PostgreSqlDialect(),
 * });
 * ```
 */

// Main export (canonical name)
export { PostgreSqlDialect } from "./postgres-dialect.js";
export { PostgreSqlInboxDialect } from "./postgres-inbox-dialect.js";

import { PostgreSqlDialect } from "./postgres-dialect.js";
/**
 * @deprecated Use `PostgreSqlDialect` instead. Will be removed in v2.0.
 */
export const PostgresDialect = PostgreSqlDialect;
