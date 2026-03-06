/**
 * Normalized database error types for Outboxy adapters
 *
 * These errors provide a consistent interface across different database implementations.
 * PostgreSQL, MySQL, SQLite, etc. all throw different error types - adapters should
 * catch those and wrap them in these normalized types.
 */

/**
 * Base class for all database-related errors
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DatabaseError";

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseError);
    }
  }
}

/**
 * Error thrown when database connection fails
 *
 * Common causes:
 * - Invalid connection string
 * - Database server unreachable
 * - Authentication failure
 * - Connection pool exhausted
 */
export class ConnectionError extends DatabaseError {
  constructor(message: string, cause?: Error) {
    super(message, cause, "CONNECTION_ERROR");
    this.name = "ConnectionError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConnectionError);
    }
  }
}

/**
 * Error thrown when a query exceeds the configured timeout
 *
 * Common causes:
 * - Long-running queries
 * - Table locks
 * - Network latency
 */
export class QueryTimeoutError extends DatabaseError {
  constructor(message: string, cause?: Error) {
    super(message, cause, "QUERY_TIMEOUT");
    this.name = "QueryTimeoutError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, QueryTimeoutError);
    }
  }
}

/**
 * Error thrown when a database constraint is violated
 *
 * Common causes:
 * - Unique constraint violation (duplicate key)
 * - Foreign key constraint violation
 * - Check constraint violation
 * - Not null constraint violation
 */
export class ConstraintViolationError extends DatabaseError {
  constructor(
    message: string,
    public readonly constraint?: string,
    cause?: Error,
  ) {
    super(message, cause, "CONSTRAINT_VIOLATION");
    this.name = "ConstraintViolationError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConstraintViolationError);
    }
  }
}

/**
 * Type for error mapping functions
 *
 * Converts database-specific errors to normalized DatabaseError types.
 */
export type ErrorMapperFn = (error: unknown) => DatabaseError;

/**
 * Create a withErrorMapping wrapper function for a given error mapper
 *
 * This factory eliminates the boilerplate of wrapping async operations
 * with try/catch and error mapping.
 *
 * @param mapError - The database-specific error mapping function
 * @returns A wrapper function that maps errors automatically
 *
 * @example
 * ```typescript
 * const withErrorMapping = createWithErrorMapping(mapPostgresError);
 *
 * const result = await withErrorMapping(async () => {
 *   return await client.query('SELECT * FROM events');
 * });
 * ```
 */
export function createWithErrorMapping(
  mapError: ErrorMapperFn,
): <T>(operation: () => Promise<T>) => Promise<T> {
  return async function withErrorMapping<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapError(error);
    }
  };
}
