import { InboxyClient } from "@outboxy/sdk";
import { PostgreSqlInboxDialect } from "@outboxy/dialect-postgres";
import type { PoolClient } from "@outboxy/testing-utils";

export function createTestInboxClient(): InboxyClient<PoolClient> {
  return new InboxyClient({
    dialect: new PostgreSqlInboxDialect(),
    adapter: (client) => async (sql, params) => {
      const result = await client.query(sql, params);
      return result.rows as { id: string }[];
    },
  });
}
