import { describe, it, expect, vi } from "vitest";
import { createPgAdapter } from "../../adapters/pg.js";
import { createPostgresJsAdapter } from "../../adapters/postgres-js.js";
import { createMysql2Adapter } from "../../adapters/mysql2.js";

describe("createPgAdapter", () => {
  it("should convert PoolClient to QueryFn", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "evt-1" }] }),
    };

    const adapter = createPgAdapter();
    const queryFn = adapter(mockClient as any);
    const result = await queryFn("INSERT INTO outbox_events ...", ["param1"]);

    expect(result).toEqual([{ id: "evt-1" }]);
    expect(mockClient.query).toHaveBeenCalledWith(
      "INSERT INTO outbox_events ...",
      ["param1"],
    );
  });
});

describe("createPostgresJsAdapter", () => {
  it("should convert postgres-js Sql to QueryFn", async () => {
    const mockSql = {
      unsafe: vi.fn().mockResolvedValue([{ id: "evt-1" }]),
    };

    const adapter = createPostgresJsAdapter();
    const queryFn = adapter(mockSql as any);
    const result = await queryFn("INSERT INTO outbox_events ...", ["param1"]);

    expect(result).toEqual([{ id: "evt-1" }]);
    expect(mockSql.unsafe).toHaveBeenCalledWith(
      "INSERT INTO outbox_events ...",
      ["param1"],
    );
  });
});

describe("createMysql2Adapter", () => {
  it("should handle SELECT results (array)", async () => {
    const mockConn = {
      execute: vi.fn().mockResolvedValue([[{ id: "evt-1" }]]),
    };

    const adapter = createMysql2Adapter();
    const queryFn = adapter(mockConn as any);
    const result = await queryFn("SELECT * FROM outbox_events", []);

    expect(result).toEqual([{ id: "evt-1" }]);
  });

  it("should handle write results with affected rows", async () => {
    const mockConn = {
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };

    const adapter = createMysql2Adapter();
    const queryFn = adapter(mockConn as any);
    const result = await queryFn("INSERT INTO outbox_events ...", ["param1"]);

    expect(result).toEqual([{ id: "" }]);
  });

  it("should handle write results with zero affected rows", async () => {
    const mockConn = {
      execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    };

    const adapter = createMysql2Adapter();
    const queryFn = adapter(mockConn as any);
    const result = await queryFn("INSERT IGNORE ...", ["param1"]);

    expect(result).toEqual([]);
  });
});
