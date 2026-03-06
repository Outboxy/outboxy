/**
 * Outboxy SDK Utilities
 *
 * Internal utility functions for the SDK.
 *
 * @packageDocumentation
 */

import { OutboxyValidationError } from "./errors.js";
import { destinationTypeEnum, type PublishEventInput } from "./types.js";

/**
 * Safely serialize a value to JSON with proper error handling
 *
 * Catches common JSON serialization issues:
 * - Circular references
 * - BigInt values
 * - Functions/Symbols
 *
 * @internal
 */
export function safeStringify(value: unknown, field: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new OutboxyValidationError(
      `Failed to serialize ${field}. Ensure it contains no circular references or BigInt values.`,
      field,
    );
  }
}

/**
 * Validate fields (eventVersion)
 *
 * @internal
 */
export function validateFields<TPayload>(
  event: PublishEventInput<TPayload>,
): void {
  if (event.eventVersion !== undefined) {
    if (!Number.isInteger(event.eventVersion) || event.eventVersion < 1) {
      throw new OutboxyValidationError(
        "eventVersion must be a positive integer",
        "eventVersion",
      );
    }
  }
}

/**
 * Validate idempotency key format and length
 *
 * @internal
 */
export function validateIdempotencyKey(key: string): void {
  if (key.length === 0) {
    throw new OutboxyValidationError(
      "Idempotency key cannot be empty",
      "idempotencyKey",
    );
  }

  if (key.length > 255) {
    throw new OutboxyValidationError(
      "Idempotency key cannot exceed 255 characters",
      "idempotencyKey",
    );
  }

  const validFormat = /^[a-zA-Z0-9_\-.:/]+$/.test(key);
  if (!validFormat) {
    throw new OutboxyValidationError(
      "Idempotency key must contain only alphanumeric characters, dashes, underscores, dots, colons, and forward slashes",
      "idempotencyKey",
    );
  }
}

/**
 * Validate destination type
 *
 * @internal
 */
export function validateDestinationType(type: string): void {
  const result = destinationTypeEnum.safeParse(type);

  if (!result.success) {
    const validTypes = destinationTypeEnum.options.join(", ");
    throw new OutboxyValidationError(
      `Invalid destinationType: "${type}". Must be one of: ${validTypes}`,
      "destinationType",
    );
  }
}
