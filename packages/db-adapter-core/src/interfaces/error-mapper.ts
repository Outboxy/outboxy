import type { DatabaseError } from "../errors.js";

/**
 * Database error mapper interface
 *
 * Implementations normalize database-specific errors into
 * consistent Outboxy error types.
 *
 * @example
 * ```typescript
 * class MySQLErrorMapper implements ErrorMapper {
 *   isDuplicateKey(error: unknown): boolean {
 *     return error instanceof Error && error.message.includes('Duplicate entry');
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface ErrorMapper {
  /**
   * Check if error represents a duplicate key/unique constraint violation
   *
   * Used to detect idempotency key conflicts.
   *
   * @param error - The error to check (can be any type)
   * @returns `true` if the error is a duplicate key violation
   */
  isDuplicateKey(error: unknown): boolean;

  /**
   * Check if error represents a database deadlock
   *
   * Deadlocks can occur during concurrent updates with locking.
   *
   * @param error - The error to check (can be any type)
   * @returns `true` if the error is a deadlock
   */
  isDeadlock(error: unknown): boolean;

  /**
   * Check if error represents a connection failure
   *
   * Includes network errors, authentication failures, and unavailability.
   *
   * @param error - The error to check (can be any type)
   * @returns `true` if the error is a connection error
   */
  isConnectionError(error: unknown): boolean;

  /**
   * Normalize any database error to a consistent DatabaseError
   *
   * Maps database-specific errors to standard error codes with
   * appropriate context from the original error.
   *
   * @param error - The error to normalize (can be any type)
   * @returns A normalized DatabaseError with appropriate code
   */
  normalize(error: unknown): DatabaseError;
}

/**
 * Database error codes
 */
export type DatabaseErrorCode =
  | "DUPLICATE_KEY"
  | "DEADLOCK"
  | "CONNECTION_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";
