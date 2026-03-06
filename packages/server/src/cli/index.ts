#!/usr/bin/env node
/**
 * Outboxy Unified CLI
 *
 * Main entry point for Docker and CLI usage.
 * Replaces docker/entrypoint.sh with a proper Node.js dispatcher.
 *
 * Usage:
 *   node dist/cli/index.js api       # Start API server
 *   node dist/cli/index.js worker    # Start worker
 *   node dist/cli/index.js migrate   # Run migrations
 *   node dist/cli/index.js help      # Show help
 */

/* eslint-disable no-console -- This is a CLI entry point */

const command = process.argv[2] || "help";

async function main() {
  // Load optional preload modules before application code.
  // Used for OTel SDK setup, custom instrumentation, etc.
  // Must run before worker/api modules are dynamically imported
  // so that auto-instrumentations can patch http/pg/undici.
  const preload = process.env.OUTBOXY_PRELOAD;
  if (preload) {
    for (const mod of preload.split(",")) {
      try {
        await import(mod.trim());
      } catch (err) {
        console.error(`Failed to load preload module "${mod.trim()}":`, err);
      }
    }
  }

  switch (command) {
    case "api": {
      const { apiMain } = await import("./api.js");
      return apiMain();
    }

    case "worker": {
      const { workerMain } = await import("./worker.js");
      return workerMain();
    }

    case "migrate": {
      if (!process.env.DATABASE_URL) {
        console.error("ERROR: DATABASE_URL environment variable is required");
        console.error("");
        console.error("Usage:");
        console.error(
          "  DATABASE_URL=postgresql://user:pass@host:5432/db node dist/cli/index.js migrate",
        );
        process.exit(1);
      }
      const { runMigrations } = await import("@outboxy/migrations");
      return runMigrations(process.env.DATABASE_URL);
    }

    case "help":
    case "--help":
    case "-h":
      console.log(`
Outboxy - Transactional Outbox Pattern as a Service

Usage: node dist/cli/index.js <command>

Commands:
  api       Start the REST API server (port 3000)
  worker    Start the event processing worker
  migrate   Run database migrations (requires DATABASE_URL)
  help      Show this help message

Environment Variables:
  DATABASE_URL          PostgreSQL/MySQL connection string (required)
  PORT                  API server port (default: 3000)
  LOG_LEVEL             Logging level: debug, info, warn, error (default: info)
  METRICS_PORT          Worker Prometheus metrics port (default: 9090)
  PUBLISHER_TYPE        http or kafka (default: http)
  POLL_INTERVAL_MS      Worker polling interval (default: 1000)
  BATCH_SIZE            Events per batch (default: 10)

Full configuration: https://github.com/outboxy/outboxy/tree/main/docs/deployment

Examples:
  # Run migrations
  DATABASE_URL=postgresql://... node dist/cli/index.js migrate

  # Start API server
  DATABASE_URL=postgresql://... node dist/cli/index.js api

  # Start worker
  DATABASE_URL=postgresql://... node dist/cli/index.js worker

Documentation: https://github.com/outboxy/outboxy
`);
      process.exit(0);
      break;

    default: {
      console.error(`Unknown command: ${command}`);

      console.error("Run 'node dist/cli/index.js help' for usage information");
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Export for direct imports (re-export the modules directly)
export * from "./api.js";
export * from "./worker.js";
