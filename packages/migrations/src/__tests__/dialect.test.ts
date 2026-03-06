import { describe, it, expect } from "vitest";
import { detectDialect, isValidDialect } from "../dialect.js";

describe("detectDialect", () => {
  describe("PostgreSQL detection", () => {
    it("should detect postgres:// prefix", () => {
      expect(detectDialect("postgres://user:pass@localhost:5432/db")).toBe(
        "postgresql",
      );
    });

    it("should detect postgresql:// prefix", () => {
      expect(detectDialect("postgresql://user:pass@localhost:5432/db")).toBe(
        "postgresql",
      );
    });

    it("should detect POSTGRESQL uppercase prefix (case insensitive)", () => {
      expect(detectDialect("POSTGRESQL://user:pass@localhost:5432/db")).toBe(
        "postgresql",
      );
    });

    it("should detect libpq-style connection string with host=", () => {
      expect(detectDialect("host=localhost dbname=mydb user=postgres")).toBe(
        "postgresql",
      );
    });

    it("should detect .postgres. cloud pattern", () => {
      expect(
        detectDialect(
          "jdbc:postgresql://mydb.postgres.database.azure.com:5432/db",
        ),
      ).toBe("postgresql");
    });

    it("should detect pgbouncer in connection string", () => {
      expect(detectDialect("postgresql://user:pass@pgbouncer:6543/db")).toBe(
        "postgresql",
      );
    });
  });

  describe("MySQL detection", () => {
    it("should detect mysql:// prefix", () => {
      expect(detectDialect("mysql://user:pass@localhost:3306/db")).toBe(
        "mysql",
      );
    });

    it("should detect mysql2:// prefix", () => {
      expect(detectDialect("mysql2://user:pass@localhost:3306/db")).toBe(
        "mysql",
      );
    });

    it("should detect MYSQL uppercase prefix (case insensitive)", () => {
      expect(detectDialect("MYSQL://user:pass@localhost:3306/db")).toBe(
        "mysql",
      );
    });

    it("should detect .mysql. cloud pattern", () => {
      expect(
        detectDialect("jdbc:mysql://mydb.mysql.database.azure.com:3306/db"),
      ).toBe("mysql");
    });

    it("should detect mariadb in connection string", () => {
      expect(detectDialect("mysql://user:pass@mariadb:3306/db")).toBe("mysql");
    });
  });

  describe("unknown dialect", () => {
    it("should throw for unrecognized connection string", () => {
      expect(() => detectDialect("redis://localhost:6379")).toThrow(
        "Unable to detect database dialect",
      );
    });

    it("should throw for empty string", () => {
      expect(() => detectDialect("")).toThrow();
    });

    it("should throw for plain hostname", () => {
      expect(() => detectDialect("localhost:5432")).toThrow();
    });

    it("should include partial connection string in error", () => {
      expect(() => detectDialect("mongodb://localhost:27017/db")).toThrow(
        /mongodb:\/\/localhost:/,
      );
    });
  });
});

describe("isValidDialect", () => {
  it("should return true for postgresql", () => {
    expect(isValidDialect("postgresql")).toBe(true);
  });

  it("should return true for mysql", () => {
    expect(isValidDialect("mysql")).toBe(true);
  });

  it("should return false for postgres (alias not valid)", () => {
    expect(isValidDialect("postgres")).toBe(false);
  });

  it("should return false for unknown dialect", () => {
    expect(isValidDialect("sqlite")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidDialect("")).toBe(false);
  });

  it("should return false for POSTGRESQL uppercase", () => {
    expect(isValidDialect("POSTGRESQL")).toBe(false);
  });
});
