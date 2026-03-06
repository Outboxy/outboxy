/**
 * Custom error classes for API error handling
 *
 * These errors are caught by the error-handler plugin and converted
 * to appropriate HTTP responses.
 */

/**
 * Resource not found error (404)
 */
export class NotFoundError extends Error {
  readonly name = "NotFoundError";
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Conflict error (409) - e.g., duplicate idempotency key
 */
export class ConflictError extends Error {
  readonly name = "ConflictError";
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Invalid state transition error (422)
 */
export class InvalidStateError extends Error {
  readonly name = "InvalidStateError";
  readonly statusCode = 422;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends Error {
  readonly name = "ValidationError";
  readonly statusCode = 400;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}
