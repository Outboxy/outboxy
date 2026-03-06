import {
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
  createWithErrorMapping,
} from "@outboxy/db-adapter-core";

export {
  DatabaseError,
  ConnectionError,
  QueryTimeoutError,
  ConstraintViolationError,
};

/**
 * PostgreSQL error codes
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_CODES = {
  // Constraint violations
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  NOT_NULL_VIOLATION: "23502",

  // Connection errors
  CONNECTION_FAILURE: "08006",
  CONNECTION_EXCEPTION: "08000",
  CONNECTION_DOES_NOT_EXIST: "08003",
  SQLCLIENT_UNABLE_TO_ESTABLISH: "08001",
  SQLSERVER_REJECTED: "08004",

  // Timeout/cancellation
  QUERY_CANCELED: "57014",
  LOCK_NOT_AVAILABLE: "55P03",

  // Admin shutdown
  ADMIN_SHUTDOWN: "57P01",

  // Deadlock
  DEADLOCK: "40P01",
} as const;

interface PostgresError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

/**
 * Map PostgreSQL native errors to normalized adapter errors
 */
export function mapPostgresError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  const pgError = error as PostgresError;
  const message = pgError.message || "Unknown database error";

  switch (pgError.code) {
    // Constraint violations
    case PG_ERROR_CODES.UNIQUE_VIOLATION:
      return new ConstraintViolationError(
        `Unique constraint violation: ${message}`,
        pgError.constraint,
        error as Error,
      );

    case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
    case PG_ERROR_CODES.CHECK_VIOLATION:
    case PG_ERROR_CODES.NOT_NULL_VIOLATION:
      return new ConstraintViolationError(
        message,
        pgError.constraint,
        error as Error,
      );

    // Connection errors
    case PG_ERROR_CODES.CONNECTION_FAILURE:
    case PG_ERROR_CODES.CONNECTION_EXCEPTION:
    case PG_ERROR_CODES.CONNECTION_DOES_NOT_EXIST:
    case PG_ERROR_CODES.SQLCLIENT_UNABLE_TO_ESTABLISH:
    case PG_ERROR_CODES.SQLSERVER_REJECTED:
    case PG_ERROR_CODES.ADMIN_SHUTDOWN:
      return new ConnectionError(message, error as Error);

    // Query timeout
    case PG_ERROR_CODES.QUERY_CANCELED:
      return new QueryTimeoutError(message, error as Error);

    // Lock timeout (treat as timeout)
    case PG_ERROR_CODES.LOCK_NOT_AVAILABLE:
      return new QueryTimeoutError("Lock acquisition timeout", error as Error);

    // Generic database error
    default:
      return new DatabaseError(message, error as Error, pgError.code);
  }
}

/**
 * Wrap async database operations with error mapping
 */
export const withErrorMapping = createWithErrorMapping(mapPostgresError);
