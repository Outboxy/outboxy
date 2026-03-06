/**
 * Constants for Outboxy schema
 */

/**
 * Maximum length for error messages stored in the database.
 *
 * Error messages are truncated to this length to prevent database bloat
 * from excessive error details (e.g., stack traces, long payloads).
 */
export const MAX_ERROR_MESSAGE_LENGTH = 1000;
