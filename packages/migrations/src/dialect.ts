/**
 * Database dialect detection and utilities
 *
 * @internal Used by migration runner only.
 * For public use, import from @outboxy/db-adapter-core instead.
 */

export type DialectType = "postgresql" | "mysql";

/**
 * Detect dialect from connection string
 *
 * @param connectionString - Database connection string
 * @returns Detected dialect type
 * @throws Error if dialect cannot be detected
 */
export function detectDialect(connectionString: string): DialectType {
  const url = connectionString.toLowerCase();

  if (
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    url.includes("host=") // libpq-style connection string
  ) {
    return "postgresql";
  }

  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) {
    return "mysql";
  }

  // Check for common cloud database patterns
  if (url.includes(".postgres.") || url.includes("pgbouncer")) {
    return "postgresql";
  }

  if (url.includes(".mysql.") || url.includes("mariadb")) {
    return "mysql";
  }

  throw new Error(
    `Unable to detect database dialect from connection string. ` +
      `Expected postgresql:// or mysql:// prefix. Got: ${connectionString.substring(0, 20)}...`,
  );
}

/**
 * Validate that a dialect string is valid
 */
export function isValidDialect(dialect: string): dialect is DialectType {
  return dialect === "postgresql" || dialect === "mysql";
}
