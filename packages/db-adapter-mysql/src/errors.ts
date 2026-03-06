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
 * MySQL error codes
 * @see https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
 */
const MYSQL_ERROR_CODES = {
  // Constraint violations
  DUPLICATE_ENTRY: 1062,
  FOREIGN_KEY_CONSTRAINT: 1451,
  FOREIGN_KEY_CONSTRAINT_ADD: 1452,
  CHECK_CONSTRAINT: 3819,
  NOT_NULL_VIOLATION: 1048,

  // Connection errors
  CONNECTION_ERROR: 2002,
  CONNECTION_LOST: 2013,
  ACCESS_DENIED: 1045,
  SERVER_GONE: 2006,
  SERVER_SHUTDOWN: 1053,

  // Timeout/deadlock
  LOCK_WAIT_TIMEOUT: 1205,
  DEADLOCK: 1213,
  QUERY_INTERRUPTED: 1317,
} as const;

interface MySQLError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  message?: string;
  sql?: string;
}

/**
 * Map MySQL native errors to normalized adapter errors
 */
export function mapMySQLError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  const mysqlError = error as MySQLError;
  const message =
    mysqlError.sqlMessage || mysqlError.message || "Unknown database error";
  const errno = mysqlError.errno;

  switch (errno) {
    // Constraint violations
    case MYSQL_ERROR_CODES.DUPLICATE_ENTRY:
      return new ConstraintViolationError(
        `Duplicate entry: ${message}`,
        undefined,
        error as Error,
      );

    case MYSQL_ERROR_CODES.FOREIGN_KEY_CONSTRAINT:
    case MYSQL_ERROR_CODES.FOREIGN_KEY_CONSTRAINT_ADD:
    case MYSQL_ERROR_CODES.CHECK_CONSTRAINT:
    case MYSQL_ERROR_CODES.NOT_NULL_VIOLATION:
      return new ConstraintViolationError(message, undefined, error as Error);

    // Connection errors
    case MYSQL_ERROR_CODES.CONNECTION_ERROR:
    case MYSQL_ERROR_CODES.CONNECTION_LOST:
    case MYSQL_ERROR_CODES.ACCESS_DENIED:
    case MYSQL_ERROR_CODES.SERVER_GONE:
    case MYSQL_ERROR_CODES.SERVER_SHUTDOWN:
      return new ConnectionError(message, error as Error);

    // Timeout/deadlock
    case MYSQL_ERROR_CODES.LOCK_WAIT_TIMEOUT:
    case MYSQL_ERROR_CODES.QUERY_INTERRUPTED:
      return new QueryTimeoutError(message, error as Error);

    case MYSQL_ERROR_CODES.DEADLOCK:
      return new DatabaseError("Deadlock detected", error as Error, "DEADLOCK");

    // Generic database error
    default:
      return new DatabaseError(message, error as Error, String(errno));
  }
}

/**
 * Wrap async database operations with error mapping
 */
export const withErrorMapping = createWithErrorMapping(mapMySQLError);
