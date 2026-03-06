import { Counter, Histogram, Gauge, Registry } from "prom-client";
import { getGlobalRegistry } from "./registry.js";
import { HISTOGRAM_BUCKETS, METRIC_LABELS } from "./constants.js";

/**
 * Worker metrics collection
 *
 * Provides Prometheus counters, histograms, and gauges for observability.
 */
export interface WorkerMetrics {
  /** Total events successfully published */
  eventsPublished: Counter<string>;
  /** Total events that failed to publish */
  eventsFailed: Counter<string>;
  /** Total events moved to dead letter queue */
  eventsDlq: Counter<string>;
  /** Total retry attempts */
  eventsRetried: Counter<string>;
  /** Event processing duration histogram */
  processingDuration: Histogram<string>;
  /** Events per poll batch */
  batchSize: Histogram<string>;
  /** Current adaptive poll interval in seconds */
  pollInterval: Gauge<string>;
  /** Configured maximum batch size */
  batchSizeConfig: Gauge<string>;
  /** Current count of pending events */
  pendingEvents: Gauge<string>;
  /** Total stale events recovered from processing state */
  staleEventsRecovered: Counter<string>;
  /** Total stale idempotency keys cleaned up */
  idempotencyKeysCleaned: Counter<string>;
  /** Total processed inbox events cleaned up */
  inboxEventsCleaned: Counter<string>;
}

/**
 * Create worker metrics registered with the given registry
 *
 * @param registry - prom-client Registry (defaults to global)
 */
export function createWorkerMetrics(registry?: Registry): WorkerMetrics {
  const reg = registry ?? getGlobalRegistry();

  return {
    eventsPublished: new Counter({
      name: "outboxy_events_published_total",
      help: "Total number of events successfully published",
      labelNames: [
        METRIC_LABELS.DESTINATION_TYPE,
        METRIC_LABELS.EVENT_TYPE,
        METRIC_LABELS.AGGREGATE_TYPE,
        METRIC_LABELS.WORKER_ID,
      ],
      registers: [reg],
    }),

    eventsFailed: new Counter({
      name: "outboxy_events_failed_total",
      help: "Total number of events that failed to publish",
      labelNames: [
        METRIC_LABELS.DESTINATION_TYPE,
        METRIC_LABELS.EVENT_TYPE,
        METRIC_LABELS.AGGREGATE_TYPE,
        METRIC_LABELS.FAILURE_REASON,
        METRIC_LABELS.WORKER_ID,
      ],
      registers: [reg],
    }),

    eventsDlq: new Counter({
      name: "outboxy_events_dlq_total",
      help: "Total number of events moved to dead letter queue",
      labelNames: [
        METRIC_LABELS.DESTINATION_TYPE,
        METRIC_LABELS.EVENT_TYPE,
        METRIC_LABELS.AGGREGATE_TYPE,
        METRIC_LABELS.WORKER_ID,
      ],
      registers: [reg],
    }),

    eventsRetried: new Counter({
      name: "outboxy_events_retried_total",
      help: "Total number of event retry attempts",
      labelNames: [
        METRIC_LABELS.DESTINATION_TYPE,
        METRIC_LABELS.EVENT_TYPE,
        METRIC_LABELS.AGGREGATE_TYPE,
        METRIC_LABELS.RETRY_COUNT,
        METRIC_LABELS.WORKER_ID,
      ],
      registers: [reg],
    }),

    processingDuration: new Histogram({
      name: "outboxy_event_processing_seconds",
      help: "Event processing duration in seconds",
      labelNames: [
        METRIC_LABELS.DESTINATION_TYPE,
        METRIC_LABELS.EVENT_TYPE,
        METRIC_LABELS.STATUS,
      ],
      buckets: [...HISTOGRAM_BUCKETS.PROCESSING_SECONDS],
      registers: [reg],
    }),

    batchSize: new Histogram({
      name: "outboxy_batch_size",
      help: "Number of events per poll batch",
      labelNames: [METRIC_LABELS.WORKER_ID],
      buckets: [...HISTOGRAM_BUCKETS.BATCH_SIZE],
      registers: [reg],
    }),

    batchSizeConfig: new Gauge({
      name: "outboxy_batch_size_config",
      help: "Configured maximum batch size",
      labelNames: [METRIC_LABELS.WORKER_ID],
      registers: [reg],
    }),

    pollInterval: new Gauge({
      name: "outboxy_poll_interval_seconds",
      help: "Current adaptive poll interval in seconds",
      labelNames: [METRIC_LABELS.WORKER_ID],
      registers: [reg],
    }),

    pendingEvents: new Gauge({
      name: "outboxy_pending_events",
      help: "Current count of pending events",
      registers: [reg],
    }),

    staleEventsRecovered: new Counter({
      name: "outboxy_stale_events_recovered_total",
      help: "Total number of stale events recovered from processing state",
      registers: [reg],
    }),

    idempotencyKeysCleaned: new Counter({
      name: "outboxy_idempotency_keys_cleaned_total",
      help: "Total number of stale idempotency keys cleaned up",
      registers: [reg],
    }),

    inboxEventsCleaned: new Counter({
      name: "outboxy_inbox_events_cleaned_total",
      help: "Total number of processed inbox events cleaned up",
      registers: [reg],
    }),
  };
}
