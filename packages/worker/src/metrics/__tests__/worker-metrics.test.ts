import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Registry } from "prom-client";
import { createWorkerMetrics } from "../worker-metrics.js";

describe("WorkerMetrics", () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  afterEach(() => {
    registry.clear();
  });

  it("should create all required metrics", () => {
    const metrics = createWorkerMetrics(registry);

    expect(metrics.eventsPublished).toBeDefined();
    expect(metrics.eventsFailed).toBeDefined();
    expect(metrics.eventsDlq).toBeDefined();
    expect(metrics.eventsRetried).toBeDefined();
    expect(metrics.processingDuration).toBeDefined();
    expect(metrics.batchSize).toBeDefined();
    expect(metrics.pollInterval).toBeDefined();
    expect(metrics.pendingEvents).toBeDefined();
    expect(metrics.batchSizeConfig).toBeDefined();
    expect(metrics.staleEventsRecovered).toBeDefined();
    expect(metrics.idempotencyKeysCleaned).toBeDefined();
    expect(metrics.inboxEventsCleaned).toBeDefined();
  });

  it("should increment events_published_total counter", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.eventsPublished.inc({
      destination_type: "http",
      event_type: "order.created",
      aggregate_type: "order",
    });

    const output = await registry.getSingleMetricAsString(
      "outboxy_events_published_total",
    );
    expect(output).toContain('destination_type="http"');
    expect(output).toContain('event_type="order.created"');
    expect(output).toContain('aggregate_type="order"');
    expect(output).toMatch(/} 1$/m);
  });

  it("should increment events_failed_total counter with failure_reason", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.eventsFailed.inc({
      destination_type: "http",
      event_type: "order.created",
      aggregate_type: "order",
      failure_reason: "timeout",
    });

    const output = await registry.getSingleMetricAsString(
      "outboxy_events_failed_total",
    );
    expect(output).toContain('failure_reason="timeout"');
    expect(output).toMatch(/} 1$/m);
  });

  it("should increment events_dlq_total counter", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.eventsDlq.inc({
      destination_type: "kafka",
      event_type: "user.updated",
      aggregate_type: "user",
    });

    const output = await registry.getSingleMetricAsString(
      "outboxy_events_dlq_total",
    );
    expect(output).toContain('destination_type="kafka"');
    expect(output).toMatch(/} 1$/m);
  });

  it("should increment events_retried_total counter with retry_count", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.eventsRetried.inc({
      destination_type: "http",
      event_type: "order.created",
      aggregate_type: "order",
      retry_count: "2",
    });

    const output = await registry.getSingleMetricAsString(
      "outboxy_events_retried_total",
    );
    expect(output).toContain('retry_count="2"');
    expect(output).toMatch(/} 1$/m);
  });

  it("should observe processing duration histogram", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.processingDuration.observe(
      {
        destination_type: "http",
        event_type: "order.created",
        status: "success",
      },
      0.05, // 50ms
    );

    const output = await registry.getSingleMetricAsString(
      "outboxy_event_processing_seconds",
    );
    expect(output).toContain("_bucket");
    expect(output).toContain("_sum");
    expect(output).toContain("_count");
    expect(output).toContain('status="success"');
  });

  it("should observe batch size histogram with worker_id label", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.batchSize.observe({ worker_id: "test" }, 10);

    const output = await registry.getSingleMetricAsString("outboxy_batch_size");
    expect(output).toContain("_bucket");
    expect(output).toContain('worker_id="test"');
    expect(output).toContain('_sum{worker_id="test"} 10');
    expect(output).toContain('_count{worker_id="test"} 1');
  });

  it("should set batch size config gauge", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.batchSizeConfig.set({ worker_id: "test" }, 100);

    const output = await registry.getSingleMetricAsString(
      "outboxy_batch_size_config",
    );
    expect(output).toContain('worker_id="test"');
    expect(output).toContain("100");
  });

  it("should set poll interval gauge with worker_id label", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.pollInterval.set({ worker_id: "test" }, 0.5); // 500ms

    const output = await registry.getSingleMetricAsString(
      "outboxy_poll_interval_seconds",
    );
    expect(output).toContain('worker_id="test"');
    expect(output).toContain("0.5");
  });

  it("should set pending events gauge", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.pendingEvents.set(100);

    const output = await registry.getSingleMetricAsString(
      "outboxy_pending_events",
    );
    expect(output).toContain("100");
  });

  it("should increment stale_events_recovered_total counter", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.staleEventsRecovered.inc(5);

    const output = await registry.getSingleMetricAsString(
      "outboxy_stale_events_recovered_total",
    );
    expect(output).toContain("5");
  });

  it("should increment idempotency_keys_cleaned_total counter", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.idempotencyKeysCleaned.inc(10);

    const output = await registry.getSingleMetricAsString(
      "outboxy_idempotency_keys_cleaned_total",
    );
    expect(output).toContain("10");
  });

  it("should increment inbox_events_cleaned_total counter", async () => {
    const metrics = createWorkerMetrics(registry);

    metrics.inboxEventsCleaned.inc(3);

    const output = await registry.getSingleMetricAsString(
      "outboxy_inbox_events_cleaned_total",
    );
    expect(output).toContain("3");
  });

  it("should use global registry when none provided", () => {
    // This test verifies the default behavior
    const metrics = createWorkerMetrics();

    expect(metrics.eventsPublished).toBeDefined();
  });
});
