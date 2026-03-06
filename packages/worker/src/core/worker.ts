import type { Logger } from "@outboxy/logging";
import type { FailureReason } from "../metrics/constants.js";
import type {
  Publisher,
  OutboxEvent,
  PublishResult,
} from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { WorkerConfig } from "../config.js";
import type { WorkerMetrics } from "../metrics/index.js";
import { resolveWorkerId } from "../utils/worker-identity.js";
import { groupBatchResults } from "../batch.js";

/**
 * Result of processing a single event
 */
interface EventProcessingResult {
  event: OutboxEvent;
  success: boolean;
  error?: Error;
  retryable: boolean;
  durationMs: number;
}

export class OutboxWorker {
  private static readonly PENDING_COUNT_INTERVAL_MS = 5000;

  private isRunning = false;
  private publisher: Publisher;
  private inFlightEvents: Set<Promise<void>> = new Set();
  private metrics?: WorkerMetrics;
  private readonly workerId: string;
  private pendingCountTimer?: ReturnType<typeof setInterval>;
  private loopPromise: Promise<void> | undefined;
  private sleepAbortController?: AbortController;

  constructor(
    private readonly config: WorkerConfig,
    private readonly repository: EventRepository,
    private logger: Logger,
    publisher: Publisher,
    metrics?: WorkerMetrics,
    workerId?: string,
  ) {
    this.publisher = publisher;
    this.metrics = metrics;
    this.workerId = workerId ?? resolveWorkerId(config.workerId).id;
    this.logger = logger.child({ workerId: this.workerId });
  }

  /** Get the worker's unique identifier */
  getWorkerId(): string {
    return this.workerId;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.logger.info("Worker started");
    this.metrics?.batchSizeConfig.set(
      { worker_id: this.workerId },
      this.config.batchSize,
    );
    this.startPendingCountTimer();

    this.loopPromise = this.runPollLoop();
    await this.loopPromise;

    this.logger.info("Worker stopped");
  }

  private async runPollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const events = await this.pollEvents();

        if (this.metrics && events.length > 0) {
          this.metrics.batchSize.observe(
            { worker_id: this.workerId },
            events.length,
          );
        }

        if (events.length === 0) {
          const idleInterval = this.calculatePollInterval(0);
          await this.sleep(idleInterval);
          continue;
        }

        this.logger.info({ eventCount: events.length }, "Processing batch");
        await this.processBatchOptimized(events);

        const pollInterval = this.calculatePollInterval(events.length);
        await this.sleep(pollInterval);
      } catch (error) {
        this.logger.error({ err: error }, "Polling failed");
        await this.sleep(this.config.pollIntervalMs);
      }
    }
  }

  /**
   * Gracefully stop the worker
   *
   * Stops polling and awaits the full polling loop lifecycle (including any
   * in-progress batch processing). Falls back to a timeout for hung publishers.
   */
  async stop(): Promise<void> {
    this.logger.info("Graceful shutdown initiated");
    this.isRunning = false;
    this.sleepAbortController?.abort();

    if (this.pendingCountTimer) {
      clearInterval(this.pendingCountTimer);
      this.pendingCountTimer = undefined;
    }

    if (!this.loopPromise) {
      this.logger.info("Graceful shutdown complete (not started)");
      return;
    }

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutTimer = setTimeout(resolve, this.config.shutdownTimeoutMs);
    });

    await Promise.race([this.loopPromise, timeoutPromise]);
    clearTimeout(timeoutTimer);
    this.loopPromise = undefined;

    if (this.inFlightEvents.size > 0) {
      this.logger.warn(
        {
          remainingCount: this.inFlightEvents.size,
          timeoutMs: this.config.shutdownTimeoutMs,
        },
        "Forced shutdown after timeout",
      );
    } else {
      this.logger.info("Graceful shutdown complete");
    }
  }

  /**
   * Calculate adaptive poll interval based on last batch size
   *
   * Uses the number of events returned in the last poll to infer queue pressure,
   * avoiding a SELECT COUNT(*) on the hot path.
   */
  private calculatePollInterval(batchEventCount: number): number {
    if (!this.config.adaptivePollingEnabled) {
      return this.config.pollIntervalMs;
    }

    let interval: number;
    if (batchEventCount >= this.config.batchSize) {
      interval = 0;
    } else if (batchEventCount >= this.config.adaptivePollingBusyThreshold) {
      interval = this.config.adaptivePollingMinPollIntervalMs * 2;
    } else if (
      batchEventCount >= this.config.adaptivePollingModerateThreshold
    ) {
      interval = this.config.adaptivePollingMinPollIntervalMs * 5;
    } else if (batchEventCount > 0) {
      interval = this.config.adaptivePollingMaxPollIntervalMs / 2;
    } else {
      interval = this.config.adaptivePollingMaxPollIntervalMs;
    }

    if (this.metrics) {
      this.metrics.pollInterval.set(
        { worker_id: this.workerId },
        interval / 1000,
      );
    }

    return interval;
  }

  /**
   * Start background timer for pending event count gauge.
   * Decoupled from the hot path to avoid a DB roundtrip per poll cycle.
   */
  private startPendingCountTimer(): void {
    if (!this.metrics) return;

    const updatePendingCount = async () => {
      try {
        const count = await this.repository.getPendingEventCount();
        this.metrics!.pendingEvents.set(count);
      } catch (error) {
        this.logger.error(
          { err: error },
          "Failed to update pending event count gauge",
        );
      }
    };

    void updatePendingCount();

    this.pendingCountTimer = setInterval(() => {
      void updatePendingCount();
    }, OutboxWorker.PENDING_COUNT_INTERVAL_MS);
  }

  private async pollEvents(): Promise<OutboxEvent[]> {
    return this.repository.claimPendingEvents(this.config.batchSize);
  }

  /**
   * Process a batch of events with optimized database operations
   *
   * Instead of N database calls for N events, this method:
   * 1. Publishes all events in parallel
   * 2. Collects results
   * 3. Groups by outcome (success, retry, dlq)
   * 4. Executes ONE batch DB operation per group
   *
   * This reduces database round-trips from N to 1-3.
   */
  private async processBatchOptimized(events: OutboxEvent[]): Promise<void> {
    const batchPromise = this.executeBatchProcessing(events);
    this.inFlightEvents.add(batchPromise);

    try {
      await batchPromise;
    } finally {
      this.inFlightEvents.delete(batchPromise);
    }
  }

  private async executeBatchProcessing(events: OutboxEvent[]): Promise<void> {
    const publishResults = await this.publishEvents(events);

    const resultsMap = new Map<string, PublishResult>();
    const retryCountMap = new Map<string, number>();
    const errorMessages = new Map<string, string>();

    for (const result of publishResults) {
      const eventId = result.event.id;
      const publishResult: PublishResult = {
        success: result.success,
        error: result.error,
        retryable: result.retryable,
      };
      resultsMap.set(eventId, publishResult);
      retryCountMap.set(eventId, result.event.retryCount ?? 0);
      if (result.error) {
        errorMessages.set(eventId, result.error.message ?? "Unknown error");
      }

      // Record metrics
      if (result.success) {
        this.recordSuccess(result.event, result.durationMs);
        this.logger.info(
          {
            eventId: result.event.id,
            eventType: result.event.eventType,
            durationMs: result.durationMs,
          },
          "Event published successfully",
        );
      } else {
        this.recordFailure(
          result.event,
          result.error!,
          result.retryable,
          result.durationMs,
        );
      }
    }

    const grouped = groupBatchResults(
      resultsMap,
      retryCountMap,
      this.config.maxRetries,
    );

    for (const eventId of grouped.retried) {
      const event = events.find((e) => e.id === eventId);
      if (event) {
        const currentRetryCount = event.retryCount ?? 0;
        this.recordRetry(event, currentRetryCount + 1);
        this.logger.info(
          {
            eventId: event.id,
            retryCount: currentRetryCount + 1,
            error: errorMessages.get(eventId),
          },
          "Event retry scheduled",
        );
      }
    }

    for (const eventId of grouped.dlq) {
      const event = events.find((e) => e.id === eventId);
      if (event) {
        this.recordDlq(event);
        this.logger.warn(
          {
            eventId: event.id,
            retryCount: event.retryCount ?? 0,
            error: errorMessages.get(eventId),
          },
          "Event moved to DLQ",
        );
      }
    }

    const succeededWithWorker = grouped.succeeded.map((eventId) => ({
      eventId,
      workerId: this.workerId,
    }));

    await Promise.all([
      succeededWithWorker.length > 0
        ? this.repository.markSucceeded(succeededWithWorker)
        : Promise.resolve(),
      grouped.retried.length > 0
        ? this.repository.scheduleRetry(grouped.retried, errorMessages, {
            backoffBaseMs: this.config.backoffBaseMs,
            backoffMultiplier: this.config.backoffMultiplier,
          })
        : Promise.resolve(),
      grouped.dlq.length > 0
        ? this.repository.moveToDLQ(grouped.dlq, errorMessages)
        : Promise.resolve(),
    ]);

    this.logger.debug(
      {
        total: events.length,
        succeeded: grouped.succeeded.length,
        retried: grouped.retried.length,
        dlq: grouped.dlq.length,
      },
      "Batch processing complete",
    );
  }

  private async publishEvents(
    events: OutboxEvent[],
  ): Promise<EventProcessingResult[]> {
    const batchStartTime = Date.now();

    try {
      const results = await this.publisher.publish(events);
      const batchDurationMs = Date.now() - batchStartTime;

      return events.map((event) => {
        const result = results.get(event.id);
        return {
          event,
          success: result?.success ?? false,
          error: result?.error,
          retryable: result?.retryable ?? true,
          durationMs: result?.durationMs ?? batchDurationMs,
        };
      });
    } catch (error) {
      return events.map((event) => ({
        event,
        success: false,
        error: error as Error,
        retryable: true,
        durationMs: Date.now() - batchStartTime,
      }));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepAbortController = new AbortController();
      const timer = setTimeout(() => resolve(), ms);
      this.sleepAbortController.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private recordSuccess(event: OutboxEvent, durationMs: number): void {
    if (!this.metrics) return;

    const labels = {
      destination_type: event.destinationType ?? "http",
      event_type: event.eventType,
      aggregate_type: event.aggregateType,
      worker_id: this.workerId,
    };

    this.metrics.eventsPublished.inc(labels);
    this.metrics.processingDuration.observe(
      {
        destination_type: event.destinationType ?? "http",
        event_type: event.eventType,
        status: "success",
      },
      durationMs / 1000,
    );
  }

  private recordFailure(
    event: OutboxEvent,
    error: Error,
    retryable: boolean,
    durationMs: number,
  ): void {
    if (!this.metrics) return;

    const destinationType = event.destinationType ?? "http";
    const failureReason = this.categorizeError(error, retryable);

    this.metrics.eventsFailed.inc({
      destination_type: destinationType,
      event_type: event.eventType,
      aggregate_type: event.aggregateType,
      failure_reason: failureReason,
      worker_id: this.workerId,
    });
    this.metrics.processingDuration.observe(
      {
        destination_type: destinationType,
        event_type: event.eventType,
        status: "failure",
      },
      durationMs / 1000,
    );
  }

  private recordDlq(event: OutboxEvent): void {
    if (!this.metrics) return;

    this.metrics.eventsDlq.inc({
      destination_type: event.destinationType ?? "http",
      event_type: event.eventType,
      aggregate_type: event.aggregateType,
      worker_id: this.workerId,
    });
  }

  private recordRetry(event: OutboxEvent, retryCount: number): void {
    if (!this.metrics) return;

    this.metrics.eventsRetried.inc({
      destination_type: event.destinationType ?? "http",
      event_type: event.eventType,
      aggregate_type: event.aggregateType,
      retry_count: String(retryCount),
      worker_id: this.workerId,
    });
  }

  private categorizeError(error: Error, retryable: boolean): FailureReason {
    const message = error.message.toLowerCase();

    if (message.includes("timeout") || message.includes("timed out")) {
      return "timeout";
    }
    if (
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("connection")
    ) {
      return "connection_error";
    }
    if (message.includes("status 4") || message.includes("status: 4")) {
      return "4xx";
    }
    if (message.includes("status 5") || message.includes("status: 5")) {
      return "5xx";
    }
    if (message.includes("kafka")) {
      return "kafka_producer";
    }
    if (!retryable) {
      return "dlq";
    }
    return "unknown";
  }
}
