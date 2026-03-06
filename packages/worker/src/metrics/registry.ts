import { Registry, collectDefaultMetrics } from "prom-client";

/**
 * Global metrics registry singleton
 *
 * Centralizes all worker metrics collection to avoid duplicate registrations.
 */
let globalRegistry: Registry | null = null;

/**
 * Get or create the global metrics registry
 *
 * Initializes default Node.js metrics on first call.
 */
export function getGlobalRegistry(): Registry {
  if (!globalRegistry) {
    globalRegistry = new Registry();
    collectDefaultMetrics({ register: globalRegistry });
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetGlobalRegistry(): void {
  if (globalRegistry) {
    globalRegistry.clear();
    globalRegistry = null;
  }
}
