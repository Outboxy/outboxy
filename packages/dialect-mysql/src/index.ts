/**
 * @outboxy/dialect-mysql
 *
 * MySQL dialect for Outboxy SDK.
 *
 * @example
 * ```typescript
 * import { OutboxyClient } from '@outboxy/sdk';
 * import { MySqlDialect } from '@outboxy/dialect-mysql';
 *
 * const client = new OutboxyClient({
 *   adapter: myMySqlAdapter,
 *   dialect: new MySqlDialect(),
 * });
 * ```
 *
 * Note: MySQL requires pre-generated UUIDs since it doesn't support RETURNING.
 * The SDK handles this automatically when using MySqlDialect.
 */

export { MySqlDialect } from "./mysql-dialect.js";
export { MySqlInboxDialect } from "./mysql-inbox-dialect.js";
