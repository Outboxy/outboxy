import type { Logger } from "@outboxy/logging";
import type { Publisher } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { WorkerConfig } from "../config.js";
import type { WorkerMetrics } from "../metrics/index.js";
import { OutboxWorker } from "./worker.js";
import { resolveWorkerId } from "../utils/worker-identity.js";

export interface WorkerClusterConfig {
  workerCount: number;
  workerIdPrefix?: string;
}

export interface ClusterStatus {
  running: boolean;
  workerCount: number;
  workerIds: string[];
}

type PublisherFactory = () => Publisher;

/**
 * WorkerCluster manages multiple OutboxWorker instances sharing a single pg.Pool
 *
 * Benefits:
 * - Single connection pool reduces database connections (N workers, ~2N+1 connections)
 * - Coordinated graceful shutdown across all workers
 * - Centralized metrics collection
 * - Workers coordinate via PostgreSQL SKIP LOCKED (no Node.js coordination needed)
 *
 * Pool sizing formula: (workerCount * 2) + 1
 * - Each worker needs ~2 connections (claim + batch update)
 * - +1 for stale recovery job
 */
export class WorkerCluster {
  private workers: OutboxWorker[] = [];
  private publishers: Publisher[] = [];
  private running = false;
  private readonly workerIdPrefix: string;

  constructor(
    private readonly repository: EventRepository,
    private readonly config: WorkerConfig,
    private readonly clusterConfig: WorkerClusterConfig,
    private readonly logger: Logger,
    private readonly publisherFactory: PublisherFactory,
    private readonly metrics?: WorkerMetrics,
  ) {
    this.workerIdPrefix =
      clusterConfig.workerIdPrefix ??
      resolveWorkerId(config.workerId).id.split("-").slice(0, 2).join("-");
  }

  /**
   * Start all workers in the cluster
   *
   * Each worker gets a unique ID (prefix-N) and its own publisher instance.
   * Workers start concurrently and coordinate via PostgreSQL SKIP LOCKED.
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn("WorkerCluster already running");
      return;
    }

    this.running = true;
    const { workerCount } = this.clusterConfig;

    this.logger.info(
      {
        workerCount,
        workerIdPrefix: this.workerIdPrefix,
      },
      "Starting WorkerCluster",
    );

    // Create all workers
    for (let i = 0; i < workerCount; i++) {
      const workerId = `${this.workerIdPrefix}-${i}`;
      const publisher = this.publisherFactory();

      // Track publisher for shutdown
      this.publishers.push(publisher);

      // Initialize publisher if needed
      await publisher.initialize?.();

      const worker = new OutboxWorker(
        this.config,
        this.repository,
        this.logger,
        publisher,
        this.metrics,
        workerId,
      );

      this.workers.push(worker);
    }

    this.logger.info(
      { workerIds: this.workers.map((w) => w.getWorkerId()) },
      "Workers created, starting...",
    );

    // Start all workers concurrently (they coordinate via SKIP LOCKED)
    await Promise.all(this.workers.map((worker) => worker.start()));
  }

  /**
   * Gracefully stop all workers in the cluster
   *
   * Stops all workers concurrently and waits for in-flight events to complete.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      this.logger.warn("WorkerCluster not running");
      return;
    }

    this.logger.info(
      { workerCount: this.workers.length },
      "Stopping WorkerCluster",
    );

    this.running = false;

    // Stop all workers concurrently
    const stopPromises = this.workers.map(async (worker) => {
      try {
        await worker.stop();
      } catch (error) {
        this.logger.error(
          { err: error, workerId: worker.getWorkerId() },
          "Error stopping worker",
        );
      }
    });

    await Promise.all(stopPromises);

    // Shutdown all publishers (CRITICAL: prevents resource leaks, flushes Kafka messages)
    const shutdownPromises = this.publishers.map(async (publisher) => {
      try {
        await publisher.shutdown?.();
      } catch (error) {
        this.logger.error({ err: error }, "Error shutting down publisher");
      }
    });

    await Promise.all(shutdownPromises);

    this.workers = [];
    this.publishers = [];
    this.logger.info("WorkerCluster stopped");
  }

  /**
   * Get the number of workers in the cluster
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Get current cluster status
   */
  getStatus(): ClusterStatus {
    return {
      running: this.running,
      workerCount: this.workers.length,
      workerIds: this.workers.map((w) => w.getWorkerId()),
    };
  }

  /**
   * Calculate recommended pool size for a given worker count
   *
   * Formula: (workerCount * 2) + 1
   * - 2 connections per worker (claim events + batch update)
   * - +1 for stale recovery job
   */
  static calculatePoolSize(workerCount: number): number {
    return workerCount * 2 + 1;
  }
}
