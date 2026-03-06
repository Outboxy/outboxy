import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  clientQuery: vi.fn().mockResolvedValue({}),
  clientRelease: vi.fn(),
  poolQuery: vi.fn().mockResolvedValue({ rows: [] }),
  poolConnect: vi.fn(),
  poolEnd: vi.fn().mockResolvedValue(undefined),
  mysqlQuery: vi.fn().mockResolvedValue([[{ count: 0 }]]),
  mysqlEnd: vi.fn().mockResolvedValue(undefined),
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue("CREATE TABLE test (id SERIAL);"),
  readdirSync: vi
    .fn()
    .mockReturnValue(["001_initial.sql", "002_add_index.sql"]),
}));

vi.mock("pg", () => {
  function Pool() {
    return {
      query: mockState.poolQuery,
      connect: mockState.poolConnect,
      end: mockState.poolEnd,
    };
  }
  return { Pool };
});

vi.mock("mysql2/promise", () => ({
  createPool: () => ({
    query: mockState.mysqlQuery,
    end: mockState.mysqlEnd,
  }),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockState.existsSync(...args),
  readFileSync: (...args: unknown[]) => mockState.readFileSync(...args),
  readdirSync: (...args: unknown[]) => mockState.readdirSync(...args),
}));

import { runMigrations, getMigrationStatus } from "../runner.js";

describe("getMigrationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.poolEnd.mockResolvedValue(undefined);
    mockState.poolConnect.mockResolvedValue({
      query: mockState.clientQuery,
      release: mockState.clientRelease,
    });
    mockState.clientQuery.mockResolvedValue({});
    mockState.readdirSync.mockReturnValue([
      "001_initial.sql",
      "002_add_index.sql",
    ]);
    mockState.existsSync.mockReturnValue(true);
    mockState.readFileSync.mockReturnValue("CREATE TABLE test (id SERIAL);");
    mockState.mysqlEnd.mockResolvedValue(undefined);
  });

  describe("postgresql", () => {
    it("should return all migrations as pending when table does not exist", async () => {
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      const status = await getMigrationStatus(
        "postgresql://localhost/testdb",
        "postgresql",
      );

      expect(status.applied).toEqual([]);
      expect(status.pending).toEqual(["001_initial", "002_add_index"]);
      expect(status.lastApplied).toBeNull();
    });

    it("should return applied and pending migrations correctly", async () => {
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ name: "001_initial", applied_at: new Date() }],
      });

      const status = await getMigrationStatus(
        "postgresql://localhost/testdb",
        "postgresql",
      );

      expect(status.applied).toEqual(["001_initial"]);
      expect(status.pending).toEqual(["002_add_index"]);
      expect(status.lastApplied).toBe("001_initial");
    });

    it("should return empty pending when all migrations applied", async () => {
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [
          { name: "002_add_index", applied_at: new Date() },
          { name: "001_initial", applied_at: new Date() },
        ],
      });

      const status = await getMigrationStatus("postgresql://localhost/testdb");

      expect(status.applied).toEqual(["002_add_index", "001_initial"]);
      expect(status.pending).toEqual([]);
      expect(status.lastApplied).toBe("002_add_index");
    });

    it("should normalize 'postgres' dialect alias to 'postgresql'", async () => {
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      const status = await getMigrationStatus(
        "postgres://localhost/testdb",
        "postgres",
      );

      expect(status.applied).toEqual([]);
    });

    it("should always call pool.end", async () => {
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      await getMigrationStatus("postgresql://localhost/testdb");

      expect(mockState.poolEnd).toHaveBeenCalled();
    });
  });

  describe("mysql", () => {
    it("should return all migrations as pending when table does not exist", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([[{ count: 0 }]]);

      const status = await getMigrationStatus(
        "mysql://user:pass@localhost:3306/testdb",
        "mysql",
      );

      expect(status.applied).toEqual([]);
      expect(status.pending).toEqual(["001_initial", "002_add_index"]);
      expect(status.lastApplied).toBeNull();
    });

    it("should return applied and pending migrations when table exists", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([[{ count: 1 }]]);
      mockState.mysqlQuery.mockResolvedValueOnce([
        [{ name: "001_initial", applied_at: new Date() }],
      ]);

      const status = await getMigrationStatus(
        "mysql://user:pass@localhost:3306/testdb",
        "mysql",
      );

      expect(status.applied).toEqual(["001_initial"]);
      expect(status.pending).toEqual(["002_add_index"]);
      expect(status.lastApplied).toBe("001_initial");
    });

    it("should call pool.end", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([[{ count: 0 }]]);

      await getMigrationStatus(
        "mysql://user:pass@localhost:3306/testdb",
        "mysql",
      );

      expect(mockState.mysqlEnd).toHaveBeenCalled();
    });
  });

  describe("unsupported dialect", () => {
    it("should throw for unsupported dialect", async () => {
      await expect(
        getMigrationStatus("sqlite:///test.db", "sqlite" as never),
      ).rejects.toThrow("Unsupported dialect");
    });
  });
});

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.poolEnd.mockResolvedValue(undefined);
    mockState.poolConnect.mockResolvedValue({
      query: mockState.clientQuery,
      release: mockState.clientRelease,
    });
    mockState.clientQuery.mockResolvedValue({});
    mockState.existsSync.mockReturnValue(true);
    mockState.readFileSync.mockReturnValue("CREATE TABLE test (id SERIAL);");
    mockState.readdirSync.mockReturnValue([
      "001_initial.sql",
      "002_add_index.sql",
    ]);
    mockState.mysqlEnd.mockResolvedValue(undefined);
  });

  describe("postgresql", () => {
    it("should create migration tracking table", async () => {
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({ rows: [] });

      await runMigrations("postgresql://localhost/testdb");

      const firstCall = mockState.poolQuery.mock.calls[0]![0] as string;
      expect(firstCall).toContain(
        "CREATE TABLE IF NOT EXISTS __outboxy_migrations",
      );
    });

    it("should skip already applied migrations", async () => {
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({
        rows: [{ name: "001_initial" }, { name: "002_add_index" }],
      });

      await runMigrations("postgresql://localhost/testdb");

      expect(mockState.poolConnect).not.toHaveBeenCalled();
    });

    it("should run pending migrations in a transaction", async () => {
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({ rows: [] });

      await runMigrations("postgresql://localhost/testdb");

      const clientCalls = mockState.clientQuery.mock.calls.map((c) => c[0]);
      expect(clientCalls).toContain("BEGIN");
      expect(clientCalls).toContain("COMMIT");
    });

    it("should rollback on migration failure", async () => {
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({ rows: [] });

      mockState.clientQuery
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("SQL syntax error"));

      await expect(
        runMigrations("postgresql://localhost/testdb"),
      ).rejects.toThrow("SQL syntax error");

      const clientCalls = mockState.clientQuery.mock.calls.map((c) => c[0]);
      expect(clientCalls).toContain("ROLLBACK");
    });

    it("should throw when migration file not found", async () => {
      mockState.existsSync.mockReturnValue(false);
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        runMigrations("postgresql://localhost/testdb"),
      ).rejects.toThrow("migration file not found");
    });

    it("should always call pool.end even on error", async () => {
      mockState.poolQuery.mockRejectedValueOnce(new Error("Connection failed"));

      await expect(
        runMigrations("postgresql://localhost/testdb"),
      ).rejects.toThrow();

      expect(mockState.poolEnd).toHaveBeenCalled();
    });

    it("should normalize postgres alias to postgresql", async () => {
      mockState.poolQuery.mockResolvedValueOnce({});
      mockState.poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        runMigrations("postgres://localhost/testdb", "postgres"),
      ).resolves.toBeUndefined();
    });
  });

  describe("mysql", () => {
    it("should create migration tracking table for mysql", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([[]]);
      mockState.mysqlQuery.mockResolvedValue([{}]);

      await runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql");

      const firstCall = mockState.mysqlQuery.mock.calls[0]![0] as string;
      expect(firstCall).toContain(
        "CREATE TABLE IF NOT EXISTS __outboxy_migrations",
      );
    });

    it("should skip already applied mysql migrations", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([
        [{ name: "001_initial" }, { name: "002_add_index" }],
      ]);

      await runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql");

      expect(mockState.mysqlQuery).toHaveBeenCalledTimes(2);
    });

    it("should run pending mysql migrations and insert tracking records", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([[]]);
      mockState.mysqlQuery.mockResolvedValue([{}]);

      await runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql");

      const allCalls = mockState.mysqlQuery.mock.calls;
      const insertCalls = allCalls.filter(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("INSERT IGNORE INTO __outboxy_migrations"),
      );
      expect(insertCalls).toHaveLength(2);
      expect(insertCalls[0]![1]).toEqual(["001_initial"]);
      expect(insertCalls[1]![1]).toEqual(["002_add_index"]);
    });

    it("should throw when mysql migration file not found", async () => {
      mockState.existsSync.mockReturnValue(false);
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([[]]); // no applied

      await expect(
        runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql"),
      ).rejects.toThrow("migration file not found");
    });

    it("should always call pool.end for mysql even on error", async () => {
      mockState.mysqlQuery.mockRejectedValueOnce(new Error("MySQL error"));

      await expect(
        runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql"),
      ).rejects.toThrow();

      expect(mockState.mysqlEnd).toHaveBeenCalled();
    });

    it("should re-throw mysql errors that are not ER_DUP_KEYNAME", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([[]]);
      const sqlError = Object.assign(new Error("Table does not exist"), {
        code: "ER_NO_SUCH_TABLE",
      });
      mockState.mysqlQuery.mockRejectedValueOnce(sqlError);

      await expect(
        runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql"),
      ).rejects.toThrow("Table does not exist");
    });

    it("should ignore ER_DUP_KEYNAME error for mysql", async () => {
      mockState.mysqlQuery.mockResolvedValueOnce([{}]);
      mockState.mysqlQuery.mockResolvedValueOnce([[]]);
      // ER_DUP_KEYNAME occurs when indexes already exist from a prior partial run
      const dupKeyError = Object.assign(new Error("ER_DUP_KEYNAME"), {
        code: "ER_DUP_KEYNAME",
      });
      mockState.mysqlQuery.mockRejectedValueOnce(dupKeyError);
      mockState.mysqlQuery.mockResolvedValue([{}]);

      await expect(
        runMigrations("mysql://user:pass@localhost:3306/testdb", "mysql"),
      ).resolves.toBeUndefined();
    });
  });

  describe("unsupported dialect", () => {
    it("should throw for unsupported dialect", async () => {
      await expect(
        runMigrations("sqlite:///test.db", "sqlite" as never),
      ).rejects.toThrow("Unsupported dialect");
    });
  });
});
