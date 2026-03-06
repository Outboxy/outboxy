import { randomUUID } from "crypto";
import os from "os";

/**
 * Worker identity information
 *
 * Used for tracking which worker processed each event.
 * The source indicates how the ID was determined.
 */
export interface WorkerIdentity {
  /** Unique identifier for this worker instance */
  id: string;
  /** How the ID was determined: explicit env var, K8s hostname, or auto-generated UUID */
  source: "env" | "hostname" | "uuid";
}

/**
 * Resolve the worker ID using a priority-based approach
 *
 * Priority order:
 * 1. Explicit WORKER_ID environment variable (for manual configuration)
 * 2. HOSTNAME environment variable (automatic in K8s pod names like "outboxy-worker-abc12")
 * 3. Auto-generated short UUID (fallback for local development)
 *
 * @param configWorkerId - Optional explicit worker ID from config
 * @returns WorkerIdentity with the resolved ID and its source
 */
export function resolveWorkerId(configWorkerId?: string): WorkerIdentity {
  // Priority 1: Explicit WORKER_ID from config/env var
  if (configWorkerId) {
    return { id: configWorkerId, source: "env" };
  }

  // Priority 2: K8s pod name from HOSTNAME (typical format: outboxy-worker-xxx-yyy)
  const hostname = process.env.HOSTNAME ?? os.hostname();
  if (hostname && hostname.includes("-")) {
    return { id: hostname, source: "hostname" };
  }

  // Priority 3: Auto-generated UUID (short form for readability)
  const uuid = randomUUID();
  return { id: `worker-${uuid.slice(0, 8)}`, source: "uuid" };
}
