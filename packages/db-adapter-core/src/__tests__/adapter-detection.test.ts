import { describe, it, expect, vi } from "vitest";
import {
  detectDatabaseType,
  isDetectionSuccess,
} from "../adapter-detection.js";
import type { DetectorMap } from "../adapter-detection.js";

const mysqlOnlyDetectors: DetectorMap = {
  mysql: () => true,
  postgres: () => false,
};

const postgresOnlyDetectors: DetectorMap = {
  mysql: () => false,
  postgres: () => true,
};

const neitherDetectors: DetectorMap = {
  mysql: () => false,
  postgres: () => false,
};

const bothDetectors: DetectorMap = {
  mysql: () => true,
  postgres: () => true,
};

describe("detectDatabaseType", () => {
  describe("explicit type override", () => {
    it("should return explicit type when provided (mysql)", () => {
      const result = detectDatabaseType(
        "postgres://host/db",
        "mysql",
        postgresOnlyDetectors,
      );
      expect(result).toEqual({ type: "mysql", ambiguous: false });
    });

    it("should return explicit type when provided (postgresql)", () => {
      const result = detectDatabaseType(
        "mysql://host/db",
        "postgresql",
        mysqlOnlyDetectors,
      );
      expect(result).toEqual({ type: "postgresql", ambiguous: false });
    });

    it("should not call detectors when explicit type is given", () => {
      const detectors: DetectorMap = {
        mysql: vi.fn(() => false),
        postgres: vi.fn(() => false),
      };
      detectDatabaseType("some://url", "mysql", detectors);
      expect(detectors.mysql).not.toHaveBeenCalled();
      expect(detectors.postgres).not.toHaveBeenCalled();
    });
  });

  describe("auto-detection", () => {
    it("should detect mysql when only mysql detector matches", () => {
      const result = detectDatabaseType(
        "mysql://host/db",
        undefined,
        mysqlOnlyDetectors,
      );
      expect(result).toEqual({ type: "mysql", ambiguous: false });
    });

    it("should detect postgresql when only postgres detector matches", () => {
      const result = detectDatabaseType(
        "postgres://host/db",
        undefined,
        postgresOnlyDetectors,
      );
      expect(result).toEqual({ type: "postgresql", ambiguous: false });
    });

    it("should return unsupported error when neither detector matches", () => {
      const result = detectDatabaseType(
        "redis://host/db",
        undefined,
        neitherDetectors,
      );
      expect(result.type).toBe("unsupported");
      if (result.type === "unsupported") {
        expect(result.error).toContain("Unsupported database type");
        expect(result.error).toContain("redis://host/db");
      }
    });

    it("should mask credentials in unsupported error message", () => {
      const result = detectDatabaseType(
        "redis://user:secret@host/db",
        undefined,
        neitherDetectors,
      );
      expect(result.type).toBe("unsupported");
      if (result.type === "unsupported") {
        expect(result.error).toContain(":***@");
        expect(result.error).not.toContain("secret");
      }
    });

    it("should default to postgresql (with ambiguous flag) when both detectors match", () => {
      const result = detectDatabaseType(
        "somedb://host/db",
        undefined,
        bothDetectors,
      );
      expect(result).toEqual({ type: "postgresql", ambiguous: true });
    });

    it("should pass the connection string to detectors", () => {
      const mysqlDetector = vi.fn(() => true);
      const postgresDetector = vi.fn(() => false);
      const detectors: DetectorMap = {
        mysql: mysqlDetector,
        postgres: postgresDetector,
      };

      detectDatabaseType("mysql://localhost:3306/mydb", undefined, detectors);

      expect(mysqlDetector).toHaveBeenCalledWith("mysql://localhost:3306/mydb");
      expect(postgresDetector).toHaveBeenCalledWith(
        "mysql://localhost:3306/mydb",
      );
    });
  });
});

describe("isDetectionSuccess", () => {
  it("should return true for mysql detection", () => {
    const result = detectDatabaseType(
      "mysql://host/db",
      undefined,
      mysqlOnlyDetectors,
    );
    expect(isDetectionSuccess(result)).toBe(true);
  });

  it("should return true for postgresql detection", () => {
    const result = detectDatabaseType(
      "postgres://host/db",
      undefined,
      postgresOnlyDetectors,
    );
    expect(isDetectionSuccess(result)).toBe(true);
  });

  it("should return false for unsupported detection", () => {
    const result = detectDatabaseType(
      "redis://host/db",
      undefined,
      neitherDetectors,
    );
    expect(isDetectionSuccess(result)).toBe(false);
  });

  it("should return true for explicit type override", () => {
    const result = detectDatabaseType(
      "any://url",
      "postgresql",
      neitherDetectors,
    );
    expect(isDetectionSuccess(result)).toBe(true);
  });
});
