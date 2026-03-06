/**
 * Adapter detection utilities for multi-database support
 *
 * Provides a shared utility for detecting database types from connection strings,
 * ensuring consistent behavior across API and Worker packages.
 */

export type AdapterDetector = (connectionString: string) => boolean;

export type DatabaseType = "mysql" | "postgresql";

export interface DetectionSuccess {
  type: DatabaseType;
  ambiguous: boolean;
}

export interface DetectionFailure {
  type: "unsupported";
  error: string;
}

export type DetectionResult = DetectionSuccess | DetectionFailure;

export interface DetectorMap {
  mysql: AdapterDetector;
  postgres: AdapterDetector;
}

/**
 * Detect database type from connection string with explicit override support
 *
 * Detection logic:
 * 1. Explicit type takes precedence over URL detection
 * 2. If no explicit type, both detectors are run
 * 3. If neither matches, returns error
 * 4. If both match, defaults to PostgreSQL (with ambiguous flag)
 * 5. If exactly one matches, returns that type
 *
 * @param connectionString - Database connection URL
 * @param explicitType - Explicit type override (takes precedence)
 * @param detectors - Detector functions for each database type
 * @returns Detection result with type or error
 */
export function detectDatabaseType(
  connectionString: string,
  explicitType: DatabaseType | undefined,
  detectors: DetectorMap,
): DetectionResult {
  // Explicit type takes precedence
  if (explicitType) {
    return { type: explicitType, ambiguous: false };
  }

  const isMySql = detectors.mysql(connectionString);
  const isPostgres = detectors.postgres(connectionString);

  // Neither can handle it
  if (!isMySql && !isPostgres) {
    const maskedUrl = connectionString.replace(/:[^:@]+@/, ":***@");
    return {
      type: "unsupported",
      error: `Unsupported database type. URL: ${maskedUrl}. Supported: mysql://, mysql2://, postgres://, postgresql://`,
    };
  }

  // Ambiguous - both can handle it (unlikely but handled defensively)
  if (isMySql && isPostgres) {
    return { type: "postgresql", ambiguous: true };
  }

  return {
    type: isMySql ? "mysql" : "postgresql",
    ambiguous: false,
  };
}

/**
 * Type guard for successful detection
 */
export function isDetectionSuccess(
  result: DetectionResult,
): result is DetectionSuccess {
  return result.type !== "unsupported";
}
