/**
 * Polling utilities for reliable test assertions
 *
 * These utilities replace hardcoded setTimeout waits with polling patterns
 * that complete as soon as the condition is met, improving test speed.
 *
 * @packageDocumentation
 */

export interface WaitForOptions {
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeout?: number;
  /** Interval between attempts in milliseconds (default: 100) */
  interval?: number;
  /** Error message prefix for timeout errors */
  message?: string;
}

/**
 * Wait for a condition to return a truthy value
 *
 * @param condition - Function that returns a value to check for truthiness
 * @param options - Timeout and interval configuration
 * @returns The truthy value returned by the condition
 * @throws Error if timeout is reached before condition returns truthy
 *
 * @example
 * ```typescript
 * // Wait for an event to be published
 * const event = await waitFor(async () => {
 *   const { rows } = await pool.query("SELECT * FROM outbox_events WHERE id = $1", [eventId]);
 *   return rows[0]?.status === "published" ? rows[0] : null;
 * }, { timeout: 5000 });
 * ```
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<NonNullable<T>> {
  const { timeout = 10000, interval = 100, message = "Condition" } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) {
        return result as NonNullable<T>;
      }
    } catch {
      // Condition threw an error, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`${message} was not met within ${timeout}ms`);
}

/**
 * Wait for a condition to be true
 *
 * @param condition - Function that returns a boolean
 * @param options - Timeout and interval configuration
 * @throws Error if timeout is reached before condition returns true
 *
 * @example
 * ```typescript
 * // Wait for worker to be idle
 * await waitForCondition(async () => {
 *   const { rows } = await pool.query("SELECT COUNT(*) FROM outbox_events WHERE status = 'pending'");
 *   return parseInt(rows[0].count) === 0;
 * }, { timeout: 5000 });
 * ```
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: WaitForOptions = {},
): Promise<void> {
  await waitFor(async () => {
    const result = await condition();
    return result ? true : null;
  }, options);
}

/**
 * Wait for a database row to match expected status
 *
 * @param queryFn - Function that queries the database and returns the row
 * @param expectedStatus - The status value to wait for
 * @param options - Timeout and interval configuration
 * @returns The row when it matches the expected status
 *
 * @example
 * ```typescript
 * const event = await waitForStatus(
 *   () => pool.query("SELECT * FROM outbox_events WHERE id = $1", [eventId]).then(r => r.rows[0]),
 *   "published",
 *   { timeout: 5000 }
 * );
 * ```
 */
export async function waitForStatus<T extends { status: string }>(
  queryFn: () => Promise<T | undefined>,
  expectedStatus: string,
  options: WaitForOptions = {},
): Promise<T> {
  const opts = {
    ...options,
    message: options.message ?? `Status to become '${expectedStatus}'`,
  };

  return waitFor(async () => {
    const row = await queryFn();
    return row?.status === expectedStatus ? row : null;
  }, opts);
}

/**
 * Wait for a specific count in the database
 *
 * @param countFn - Function that returns the current count
 * @param expectedCount - The count to wait for
 * @param options - Timeout and interval configuration
 *
 * @example
 * ```typescript
 * await waitForCount(
 *   async () => {
 *     const { rows } = await pool.query("SELECT COUNT(*) FROM outbox_events WHERE status = 'published'");
 *     return parseInt(rows[0].count);
 *   },
 *   10,
 *   { timeout: 5000 }
 * );
 * ```
 */
export async function waitForCount(
  countFn: () => Promise<number>,
  expectedCount: number,
  options: WaitForOptions = {},
): Promise<void> {
  const opts = {
    ...options,
    message: options.message ?? `Count to reach ${expectedCount}`,
  };

  await waitFor(async () => {
    const count = await countFn();
    return count === expectedCount ? true : null;
  }, opts);
}

/**
 * Wait for a minimum count in the database
 *
 * @param countFn - Function that returns the current count
 * @param minCount - The minimum count to wait for
 * @param options - Timeout and interval configuration
 * @returns The actual count when it reaches the minimum
 *
 * @example
 * ```typescript
 * const count = await waitForMinCount(
 *   async () => {
 *     const { rows } = await pool.query("SELECT COUNT(*) FROM outbox_events WHERE status = 'published'");
 *     return parseInt(rows[0].count);
 *   },
 *   5,
 *   { timeout: 5000 }
 * );
 * ```
 */
export async function waitForMinCount(
  countFn: () => Promise<number>,
  minCount: number,
  options: WaitForOptions = {},
): Promise<number> {
  const opts = {
    ...options,
    message: options.message ?? `Count to reach at least ${minCount}`,
  };

  return waitFor(async () => {
    const count = await countFn();
    return count >= minCount ? count : null;
  }, opts);
}

export interface WaitForEventsOptions extends WaitForOptions {
  /** Status to wait for (default: 'succeeded') */
  status?: string | string[];
  /** Callback for progress updates */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Wait for all outbox events to be processed to a specific status
 *
 * Commonly used pattern in integration tests to wait for the worker
 * to process all events before making assertions.
 *
 * @param pool - PostgreSQL connection pool
 * @param expectedCount - Number of events to wait for
 * @param options - Timeout, status, and progress callback configuration
 * @returns The actual count when it reaches the expected count
 *
 * @example
 * ```typescript
 * // Wait for 100 events to be succeeded (default)
 * await waitForEventsProcessed(pool, 100, { timeout: 15000 });
 *
 * // Wait with progress logging
 * await waitForEventsProcessed(pool, 100, {
 *   timeout: 15000,
 *   onProgress: (processed, total) => console.log(`${processed}/${total}`)
 * });
 *
 * // Wait for events to be in 'failed' status
 * await waitForEventsProcessed(pool, 5, { status: 'failed' });
 *
 * // Wait for events to be in multiple statuses
 * await waitForEventsProcessed(pool, 10, { status: ['processing', 'succeeded'] });
 * ```
 */
export async function waitForEventsProcessed(
  pool: {
    query: (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: { count: string }[] }>;
  },
  expectedCount: number,
  options: WaitForEventsOptions = {},
): Promise<number> {
  const {
    timeout = 15000,
    interval = 200,
    status = "succeeded",
    onProgress,
  } = options;

  const statusList = Array.isArray(status) ? status : [status];
  const statusPlaceholders = statusList.map((_, i) => `$${i + 1}`).join(", ");
  const query = `SELECT COUNT(*) as count FROM outbox_events WHERE status IN (${statusPlaceholders})`;

  const startTime = Date.now();
  let processedCount = 0;

  while (processedCount < expectedCount && Date.now() - startTime < timeout) {
    const result = await pool.query(query, statusList);
    processedCount = Number(result.rows[0]!.count);

    if (onProgress) {
      onProgress(processedCount, expectedCount);
    }

    if (processedCount >= expectedCount) {
      return processedCount;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  if (processedCount < expectedCount) {
    throw new Error(
      `Expected ${expectedCount} events with status '${statusList.join(", ")}' but only ${processedCount} found after ${timeout}ms`,
    );
  }

  return processedCount;
}

/**
 * Wait for any events to start processing
 *
 * Useful for tests that need to verify the worker has started
 * before triggering a shutdown or other action.
 *
 * @param pool - PostgreSQL connection pool
 * @param options - Timeout and interval configuration
 * @returns The count of events that have started processing
 *
 * @example
 * ```typescript
 * // Wait for worker to start processing
 * void worker.start();
 * await waitForProcessingStarted(pool, { timeout: 10000 });
 * // Now trigger graceful shutdown
 * await worker.stop();
 * ```
 */
export async function waitForProcessingStarted(
  pool: { query: (text: string) => Promise<{ rows: { count: string }[] }> },
  options: WaitForOptions = {},
): Promise<number> {
  const { timeout = 10000, interval = 50 } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status IN ('processing', 'succeeded')",
    );
    const count = Number(result.rows[0]!.count);

    if (count > 0) {
      return count;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`No events started processing within ${timeout}ms`);
}

/**
 * Row returned from outbox_events status queries
 */
export interface OutboxEventRow {
  status: string;
  retry_count: number;
  last_error: string | null;
}

/**
 * Wait for a specific outbox event to reach expected status.
 *
 * Returns the full event row including retry_count and last_error,
 * which is commonly needed in e2e tests for validation.
 *
 * @param pool - PostgreSQL connection pool
 * @param eventId - The event ID to wait for
 * @param expectedStatus - The status to wait for (e.g., "succeeded", "failed", "dlq")
 * @param options - Timeout and interval configuration
 * @returns The event row when it reaches the expected status
 *
 * @example
 * ```typescript
 * const event = await waitForOutboxEventStatus(pool, eventId, "succeeded");
 * expect(event.retry_count).toBe(0);
 * expect(event.last_error).toBeNull();
 * ```
 */
export async function waitForOutboxEventStatus(
  pool: {
    query: (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: OutboxEventRow[] }>;
  },
  eventId: string,
  expectedStatus: string,
  options: WaitForOptions = {},
): Promise<OutboxEventRow> {
  const { timeout = 15000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { rows } = await pool.query(
      `SELECT status, retry_count, last_error FROM outbox_events WHERE id = $1`,
      [eventId],
    );

    if (rows[0] && rows[0].status === expectedStatus) {
      return rows[0];
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(
    `Timeout waiting for event ${eventId} to reach status ${expectedStatus}`,
  );
}
