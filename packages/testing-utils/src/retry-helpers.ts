/**
 * Retry utilities for test setup and database operations
 *
 * Provides retry patterns with exponential backoff for handling
 * transient failures during container startup and database operations.
 *
 * @packageDocumentation
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 10) */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelayMs?: number;
  /** Optional name for logging retry attempts */
  name?: string;
  /** Function to determine if an error is retryable (default: connection errors) */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Default check for connection/transient errors
 */
export function isConnectionError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return (
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ETIMEDOUT" ||
    err.code === "57P03" || // PostgreSQL: connection not ready
    err.errno === 2003 || // MySQL: connection refused
    err.message?.includes("connect ECONNREFUSED") === true
  );
}

/**
 * Execute an async operation with exponential backoff retry
 *
 * @param operation - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the operation
 * @throws The last error if all attempts fail
 *
 * @example
 * ```typescript
 * // Retry database connection
 * await retryWithBackoff(
 *   async () => {
 *     await pool.query("SELECT 1");
 *   },
 *   { maxAttempts: 5, name: "db-health-check" }
 * );
 *
 * // Retry with custom error check
 * await retryWithBackoff(
 *   async () => { ... },
 *   {
 *     maxAttempts: 3,
 *     isRetryable: (err) => err.code === "LOCK_TIMEOUT"
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 10,
    baseDelayMs = 100,
    name,
    isRetryable = isConnectionError,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, etc.
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      if (name) {
        console.log(
          `\u26a0\ufe0f Connection attempt ${attempt}/${maxAttempts} failed for '${name}', retrying in ${delay}ms...`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error(`Operation failed after ${maxAttempts} attempts`);
}

/**
 * Wait for a service to be ready using polling
 *
 * This is a specialized version of retry for readiness checks that
 * returns void and provides progress logging.
 *
 * @param checkFn - Function that throws if service is not ready
 * @param options - Timeout, interval, and label configuration
 *
 * @example
 * ```typescript
 * await waitForServiceReady(
 *   async () => {
 *     const client = await pool.connect();
 *     await client.query("SELECT 1");
 *     client.release();
 *   },
 *   { timeout: 30000, label: "PostgreSQL" }
 * );
 * ```
 */
export async function waitForServiceReady(
  checkFn: () => Promise<void>,
  options: { timeout: number; interval?: number; label: string },
): Promise<void> {
  const { timeout, interval = 100, label } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await checkFn();
      console.log(`\u2713 ${label} ready in ${Date.now() - startTime}ms`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  throw new Error(`${label} not ready after ${timeout}ms`);
}
