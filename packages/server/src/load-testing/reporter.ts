/**
 * Load test result reporter
 *
 * Formats test results for human-readable or JSON output.
 */

/* eslint-disable no-console -- This is a reporting utility for CLI output */

import type { PerformanceMetrics, ThresholdResult } from "./metrics.js";

export type OutputFormat = "human" | "json";

export interface TestResult {
  test: string;
  timestamp: string;
  events: {
    total: number;
    processed: number;
    failed: number;
    successRate: number;
  };
  duration: {
    ms: number;
    formatted: string;
  };
  throughput: {
    eventsPerSec: number;
    threshold: number;
    passed: boolean;
  };
  latency: {
    min: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    avg: number;
  };
  result: "PASSED" | "FAILED";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format metrics as a structured test result
 */
export function createTestResult(
  testName: string,
  metrics: PerformanceMetrics,
  thresholdResult: ThresholdResult,
): TestResult {
  return {
    test: testName,
    timestamp: new Date().toISOString(),
    events: {
      total: metrics.totalEvents,
      processed: metrics.processedEvents,
      failed: metrics.failedEvents,
      successRate: Math.round(metrics.successRate * 100) / 100,
    },
    duration: {
      ms: metrics.durationMs,
      formatted: formatDuration(metrics.durationMs),
    },
    throughput: {
      eventsPerSec: Math.round(metrics.throughputEventsPerSec * 10) / 10,
      threshold: thresholdResult.threshold,
      passed: thresholdResult.passed,
    },
    latency: {
      min: Math.round(metrics.minLatency),
      p50: Math.round(metrics.p50Latency),
      p95: Math.round(metrics.p95Latency),
      p99: Math.round(metrics.p99Latency),
      max: Math.round(metrics.maxLatency),
      avg: Math.round(metrics.avgLatency),
    },
    result: thresholdResult.passed ? "PASSED" : "FAILED",
  };
}

/**
 * Format test result as JSON string
 */
export function formatJson(result: TestResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format test result as human-readable output
 */
export function formatHuman(result: TestResult): string {
  const passIcon = result.result === "PASSED" ? "\u2705" : "\u274c";
  const thresholdIcon = result.throughput.passed ? "\u2705" : "\u274c";

  const lines = [
    "",
    "=".repeat(80),
    `\uD83D\uDCCA Load Test Results - ${result.events.total.toLocaleString()} Events`,
    "=".repeat(80),
    "",
    `Total Events:       ${result.events.total.toLocaleString()}`,
    `Processed Events:   ${result.events.processed.toLocaleString()} (${result.events.successRate}%)`,
    `Failed Events:      ${result.events.failed.toLocaleString()}`,
    `Duration:           ${result.duration.formatted}`,
    `Throughput:         ${result.throughput.eventsPerSec} events/sec ${thresholdIcon} (threshold: ${result.throughput.threshold})`,
    "",
    "Latency (processing_started_at \u2192 processed_at):",
    `  Min:              ${formatLatency(result.latency.min)}`,
    `  P50 (median):     ${formatLatency(result.latency.p50)}`,
    `  P95:              ${formatLatency(result.latency.p95)}`,
    `  P99:              ${formatLatency(result.latency.p99)}`,
    `  Max:              ${formatLatency(result.latency.max)}`,
    `  Average:          ${formatLatency(result.latency.avg)}`,
    "",
    `Result: ${result.result} ${passIcon}`,
    "=".repeat(80),
    "",
  ];

  return lines.join("\n");
}

/**
 * Format and output test result
 */
export function reportResult(result: TestResult, format: OutputFormat): void {
  if (format === "json") {
    console.log(formatJson(result));
  } else {
    console.log(formatHuman(result));
  }
}

/**
 * Print progress message during test execution
 */
export function reportProgress(
  phase: string,
  message: string,
  format: OutputFormat,
): void {
  if (format === "human") {
    console.log(`${phase} ${message}`);
  }
}

/**
 * Render concurrent insert/process progress on a single terminal line.
 *
 * Output: `Insert: 6,700/10,000 (67%)  |  Process: 1,800/10,000 (18%)  |  Queue: 4,900`
 */
export function updateConcurrentProgress(
  inserted: number,
  processed: number,
  total: number,
  format: OutputFormat,
): void {
  if (format !== "human") return;

  const insertPct = total > 0 ? (inserted / total) * 100 : 0;
  const processPct = total > 0 ? (processed / total) * 100 : 0;
  const queue = Math.max(0, inserted - processed);

  const line = `Insert: ${inserted.toLocaleString()}/${total.toLocaleString()} (${insertPct.toFixed(0)}%)  |  Process: ${processed.toLocaleString()}/${total.toLocaleString()} (${processPct.toFixed(0)}%)  |  Queue: ${queue.toLocaleString()}`;

  const termWidth = process.stdout.columns ?? 80;
  const padding = Math.max(0, termWidth - line.length);
  process.stdout.write(`\r${line}${" ".repeat(padding)}`);
}

/**
 * Move past the current in-place progress bar so subsequent output starts on a new line.
 */
export function finishProgressBar(format: OutputFormat): void {
  if (format !== "human") return;
  process.stdout.write("\n");
}
