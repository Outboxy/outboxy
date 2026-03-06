#!/usr/bin/env tsx
/**
 * Outboxy Load Test CLI
 *
 * Standalone load testing script for worker performance validation.
 *
 * Usage:
 *   pnpm --filter @outboxy/server load-test --database-url postgresql://...
 *   pnpm --filter @outboxy/server load-test -d postgresql://... --events 100000
 *   pnpm --filter @outboxy/server load-test -d postgresql://... --format json
 *
 * Database setup:
 *   docker run --name outboxy-loadtest -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test -e POSTGRES_DB=outboxy_test -p 5432:5432 -d postgres:16
 */

/* eslint-disable no-console -- This is a CLI script */

import { Pool } from "pg";
import { runMigrations } from "@outboxy/migrations";
import { runLoadTest, type OutputFormat } from "../src/load-testing/index.js";
import { queryTestTimeWindow } from "../src/load-testing/metrics.js";

interface CliOptions {
  events: number;
  format: OutputFormat;
  databaseUrl: string | null;
  threshold: number;
  batchSize: number;
  pollInterval: number;
  timeout: number;
  workers: number;
  insertRate: number;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Outboxy Load Test CLI

Usage:
  pnpm --filter @outboxy/worker load-test --database-url <url> [options]

Required:
  -d, --database-url <url>     PostgreSQL connection string (required)

Options:
  -e, --events <number>        Number of events to process (default: 10000)
  -f, --format <format>        Output format: human, json (default: human)
  -t, --threshold <number>     Minimum events/sec for pass (default: 100)
  -b, --batch-size <number>    Worker batch size (default: 100)
  -p, --poll-interval <number> Poll interval in ms (default: 50)
  -w, --workers <number>       Number of concurrent workers (default: 1)
  --insert-rate <number>       Event insertion rate in events/sec (default: 0 = burst)
  --timeout <number>           Max test duration in ms (default: 3600000)
  -h, --help                   Show this help message

Database Setup:
  # Start a local PostgreSQL container
  docker run --name outboxy-loadtest \\
    -e POSTGRES_PASSWORD=test \\
    -e POSTGRES_USER=test \\
    -e POSTGRES_DB=outboxy_test \\
    -p 5432:5432 \\
    -d postgres:16

  # Then run the load test
  pnpm --filter @outboxy/worker load-test \\
    -d postgresql://test:test@localhost:5432/outboxy_test

Examples:
  # Run 10K events test (burst insertion)
  pnpm --filter @outboxy/worker load-test -d postgresql://test:test@localhost:5432/outboxy_test

  # Run with rate-limited insertion (500 events/sec)
  pnpm --filter @outboxy/worker load-test -d postgresql://... --events 10000 --insert-rate 500

  # Run 100K events with JSON output
  pnpm --filter @outboxy/worker load-test -d postgresql://... --events 100000 --format json

  # Run with custom threshold (500 events/sec)
  pnpm --filter @outboxy/worker load-test -d postgresql://... --events 50000 --threshold 500

Scenarios:
  10K events   - Quick validation (~10-15 seconds)
  100K events  - Standard load test (~2-3 minutes)
  1M events    - Stress test (~15-35 minutes)
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    events: 10000,
    format: "human",
    databaseUrl: null,
    threshold: 100,
    batchSize: 100,
    pollInterval: 50,
    timeout: 3600000,
    workers: 4,
    insertRate: 0,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-e":
      case "--events":
        options.events = parseInt(nextArg, 10);
        i++;
        break;
      case "-f":
      case "--format":
        options.format = nextArg as OutputFormat;
        i++;
        break;
      case "-d":
      case "--database-url":
        options.databaseUrl = nextArg;
        i++;
        break;
      case "-t":
      case "--threshold":
        options.threshold = parseInt(nextArg, 10);
        i++;
        break;
      case "-b":
      case "--batch-size":
        options.batchSize = parseInt(nextArg, 10);
        i++;
        break;
      case "-p":
      case "--poll-interval":
        options.pollInterval = parseInt(nextArg, 10);
        i++;
        break;
      case "--insert-rate":
        options.insertRate = parseInt(nextArg, 10);
        i++;
        break;
      case "--timeout":
        options.timeout = parseInt(nextArg, 10);
        i++;
        break;
      case "-w":
      case "--workers":
        options.workers = parseInt(nextArg, 10);
        i++;
        break;
    }
  }

  return options;
}

function waitForExit(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write("\nPress Enter to exit...");
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.databaseUrl) {
    console.error("Error: --database-url is required");
    console.error("Run with --help for usage information");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 50,
  });

  try {
    if (options.format === "human") {
      console.log("\u2705 Connected to database");
      console.log("\uD83D\uDCE6 Running migrations...");
    }

    await runMigrations(options.databaseUrl);

    if (options.format === "human") {
      console.log("\u2705 Migrations complete");
    }

    const result = await runLoadTest(pool, options.databaseUrl, {
      eventCount: options.events,
      thresholdEventsPerSec: options.threshold,
      batchSize: options.batchSize,
      pollIntervalMs: options.pollInterval,
      timeoutMs: options.timeout,
      outputFormat: options.format,
      workerCount: options.workers,
      insertRate: options.insertRate,
    });

    const grafanaUrl = process.env.GRAFANA_URL;
    if (grafanaUrl && options.format === "human") {
      const timeWindow = await queryTestTimeWindow(pool);
      if (timeWindow) {
        const timeRange = `?from=${timeWindow.startMs}&to=${timeWindow.endMs}`;
        console.log(
          `\nGrafana (review):      ${grafanaUrl}/d/outboxy-worker-load-test${timeRange}`,
        );
        console.log(
          `Grafana (PG monitor):  ${grafanaUrl}/d/postgres-load-test-diagnostics${timeRange}`,
        );
      }
    }

    if (options.format === "human") {
      await waitForExit();
    }

    await pool.end();

    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error("Load test failed with error:", error);
    if (options.format === "human") {
      await waitForExit();
    }
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
