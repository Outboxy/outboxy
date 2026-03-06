/**
 * Multi-worker runner for load testing
 *
 * Spawns multiple OutboxWorker instances that compete for events
 * using PostgreSQL SKIP LOCKED for coordination.
 */

import type { Pool } from "pg";
import type { Logger } from "@outboxy/logging";
import type { Publisher } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import { OutboxWorker } from "@outboxy/worker";
import type { WorkerConfig, WorkerMetrics } from "@outboxy/worker";

export interface MultiWorkerContext {
  workers: OutboxWorker[];
  workerIds: string[];
  promises: Promise<void>[];
}

/**
 * Create and start multiple workers for load testing
 *
 * Each worker gets a unique ID (load-test-worker-1, load-test-worker-2, etc.)
 * and competes for events using SKIP LOCKED.
 *
 * @param repository - Event repository to use for all workers
 * @param publisherFactory - Factory function to create a publisher for each worker
 */
export function createMultiWorkerContext(
  repository: EventRepository,
  workerCount: number,
  config: WorkerConfig,
  logger: Logger,
  publisherFactory: (logger: Logger) => Publisher,
  metrics?: WorkerMetrics,
): MultiWorkerContext {
  const workers: OutboxWorker[] = [];
  const workerIds: string[] = [];
  const promises: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    const workerId = `load-test-worker-${i + 1}`;
    workerIds.push(workerId);

    const workerLogger = logger.child({ workerId });
    const publisher = publisherFactory(workerLogger);

    const worker = new OutboxWorker(
      config,
      repository,
      workerLogger,
      publisher,
      metrics,
      workerId,
    );

    workers.push(worker);
  }

  return { workers, workerIds, promises };
}

/**
 * Start all workers in the context
 */
export function startAllWorkers(context: MultiWorkerContext): void {
  for (const worker of context.workers) {
    context.promises.push(worker.start());
  }
}

/**
 * Stop all workers and wait for them to finish
 */
export async function stopAllWorkers(
  context: MultiWorkerContext,
): Promise<void> {
  await Promise.all(context.workers.map((w) => w.stop()));
  await Promise.all(context.promises.map((p) => p.catch(() => {})));
}

/**
 * Query worker distribution from database
 *
 * Returns a map of workerId -> event count showing how work was distributed.
 */
export async function getWorkerDistribution(
  pool: Pool,
): Promise<Map<string, number>> {
  const result = await pool.query(`
    SELECT processed_by_worker, COUNT(*) as count
    FROM outbox_events
    WHERE processed_by_worker IS NOT NULL
      AND status = 'succeeded'
    GROUP BY processed_by_worker
    ORDER BY count DESC
  `);

  const distribution = new Map<string, number>();
  for (const row of result.rows) {
    distribution.set(row.processed_by_worker, Number(row.count));
  }
  return distribution;
}

/**
 * Format worker distribution for display
 */
export function formatWorkerDistribution(
  distribution: Map<string, number>,
): string[] {
  const lines: string[] = [];
  for (const [workerId, count] of distribution) {
    lines.push(`  ${workerId}: ${count.toLocaleString()} events`);
  }
  return lines;
}
