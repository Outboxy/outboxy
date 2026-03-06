/**
 * Load test metrics calculation
 *
 * Extracts and calculates performance metrics from test runs.
 * Latency is measured from DB timestamps for accuracy.
 */

import type { Pool } from "pg";

export interface LatencyData {
  latencyMs: number;
}

export interface PerformanceMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  successRate: number;
  durationMs: number;
  throughputEventsPerSec: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}

export interface ThresholdResult {
  passed: boolean;
  threshold: number;
  actual: number;
  message: string;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.floor(sortedArr.length * p);
  return sortedArr[Math.min(index, sortedArr.length - 1)] ?? 0;
}

export interface TestTimeWindow {
  startMs: number;
  endMs: number;
}

/**
 * Query the exact worker processing window from DB timestamps.
 * Uses MIN/MAX of processing_started_at/processed_at to capture
 * only actual worker activity, excluding the event insertion phase.
 */
export async function queryTestTimeWindow(
  pool: Pool,
): Promise<TestTimeWindow | null> {
  const result = await pool.query(`
    SELECT
      EXTRACT(EPOCH FROM MIN(processing_started_at)) * 1000 AS start_ms,
      EXTRACT(EPOCH FROM MAX(processed_at)) * 1000 AS end_ms
    FROM outbox_events
    WHERE status = 'succeeded'
      AND processing_started_at IS NOT NULL
      AND processed_at IS NOT NULL
  `);

  const row = result.rows[0];
  if (!row?.start_ms || !row?.end_ms) return null;

  return {
    startMs: Math.floor(Number(row.start_ms)),
    endMs: Math.floor(Number(row.end_ms)),
  };
}

/**
 * Query DB for processing latency using timestamps stored by the worker
 */
export async function queryLatenciesFromDb(pool: Pool): Promise<LatencyData[]> {
  const result = await pool.query(`
    SELECT
      EXTRACT(EPOCH FROM (processed_at - processing_started_at)) * 1000 AS latency_ms
    FROM outbox_events
    WHERE status = 'succeeded'
      AND processing_started_at IS NOT NULL
      AND processed_at IS NOT NULL
  `);

  return result.rows.map((row: { latency_ms: string }) => ({
    latencyMs: Number(row.latency_ms),
  }));
}

/**
 * Calculate performance metrics from DB-sourced latency data
 */
export function calculateMetrics(
  totalEvents: number,
  processedEvents: number,
  failedEvents: number,
  durationMs: number,
  latencies: LatencyData[],
): PerformanceMetrics {
  const sorted = latencies.map((l) => l.latencyMs).sort((a, b) => a - b);

  const avg =
    sorted.length > 0
      ? sorted.reduce((sum, val) => sum + val, 0) / sorted.length
      : 0;

  return {
    totalEvents,
    processedEvents,
    failedEvents,
    successRate: totalEvents > 0 ? (processedEvents / totalEvents) * 100 : 0,
    durationMs,
    throughputEventsPerSec:
      durationMs > 0 ? (processedEvents / durationMs) * 1000 : 0,
    p50Latency: percentile(sorted, 0.5),
    p95Latency: percentile(sorted, 0.95),
    p99Latency: percentile(sorted, 0.99),
    avgLatency: avg,
    minLatency: sorted[0] ?? 0,
    maxLatency: sorted[sorted.length - 1] ?? 0,
  };
}

/**
 * Validate metrics against throughput threshold
 */
export function validateThreshold(
  metrics: PerformanceMetrics,
  thresholdEventsPerSec: number,
): ThresholdResult {
  const passed = metrics.throughputEventsPerSec >= thresholdEventsPerSec;

  return {
    passed,
    threshold: thresholdEventsPerSec,
    actual: metrics.throughputEventsPerSec,
    message: passed
      ? `Throughput ${metrics.throughputEventsPerSec.toFixed(1)} events/sec >= ${thresholdEventsPerSec} threshold`
      : `Throughput ${metrics.throughputEventsPerSec.toFixed(1)} events/sec < ${thresholdEventsPerSec} threshold`,
  };
}
