/**
 * Outboxy SDK Error Types
 *
 * Custom error classes for typed error handling in SDK consumers.
 * All errors extend the base OutboxyError class for consistent handling.
 *
 * @packageDocumentation
 */

/**
 * Base error class for all Outboxy SDK errors
 *
 * Provides a common interface with error codes for programmatic error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await outboxy.publish(event);
 * } catch (error) {
 *   if (error instanceof OutboxyError) {
 *     console.error(`Outboxy error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export class OutboxyError extends Error {
  override readonly name: string = "OutboxyError";
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * JSON serialization includes code for logging/debugging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
    };
  }
}

/**
 * Validation error for invalid input data
 *
 * Thrown when event data fails validation (e.g., invalid idempotency key,
 * missing required fields, exceeds length limits).
 *
 * @example
 * ```typescript
 * try {
 *   await outboxy.publish(event);
 * } catch (error) {
 *   if (error instanceof OutboxyValidationError) {
 *     console.error(`Validation failed on field: ${error.field}`);
 *   }
 * }
 * ```
 */
export class OutboxyValidationError extends OutboxyError {
  override readonly name: string = "OutboxyValidationError";
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR");
    this.field = field;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      name: this.name,
      field: this.field,
    };
  }
}

/**
 * Database connection error
 *
 * Thrown when the SDK cannot communicate with the database.
 * Includes the original error as `cause` for debugging.
 *
 * @example
 * ```typescript
 * try {
 *   await outboxy.publish(event);
 * } catch (error) {
 *   if (error instanceof OutboxyConnectionError) {
 *     console.error("Database unavailable:", error.cause?.message);
 *   }
 * }
 * ```
 */
export class OutboxyConnectionError extends OutboxyError {
  override readonly name: string = "OutboxyConnectionError";
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, "CONNECTION_ERROR");
    this.cause = cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      name: this.name,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
    };
  }
}

/**
 * Duplicate idempotency key error
 *
 * Thrown when an idempotency key already exists in the database.
 * The `existingEventId` property contains the ID of the original event,
 * which can be used for idempotent retry handling.
 *
 * Note: This is distinct from the normal duplicate handling where
 * `publish()` returns the existing event ID. This error is thrown
 * when there's a conflict (e.g., same key but different aggregate).
 *
 * @example
 * ```typescript
 * try {
 *   await outboxy.publish(event);
 * } catch (error) {
 *   if (error instanceof OutboxyDuplicateError) {
 *     console.log(`Event already exists: ${error.existingEventId}`);
 *   }
 * }
 * ```
 */
export class OutboxyDuplicateError extends OutboxyError {
  override readonly name: string = "OutboxyDuplicateError";
  readonly existingEventId: string;
  readonly idempotencyKey: string;

  constructor(
    message: string,
    existingEventId: string,
    idempotencyKey: string,
  ) {
    super(message, "DUPLICATE_IDEMPOTENCY_KEY");
    this.existingEventId = existingEventId;
    this.idempotencyKey = idempotencyKey;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      name: this.name,
      existingEventId: this.existingEventId,
      idempotencyKey: this.idempotencyKey,
    };
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an error is a PostgreSQL connection error
 *
 * @internal
 */
export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const pgConnectionCodes = [
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "08000", // connection_exception
    "08003", // connection_does_not_exist
    "08006", // connection_failure
  ];

  const errorWithCode = error as Error & { code?: string };
  return pgConnectionCodes.includes(errorWithCode.code ?? "");
}
