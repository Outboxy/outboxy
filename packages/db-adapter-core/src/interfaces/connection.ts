import type { ConnectionHealthStatus } from "../types.js";

/**
 * Interface for database connection lifecycle management
 *
 * Adapters must implement proper connection pooling and graceful
 * shutdown to prevent connection leaks.
 */
export interface ConnectionManager {
  /**
   * Initialize the database connection
   *
   * Called once at startup. Should:
   * - Create connection pool
   * - Verify database connectivity
   * - Run any startup checks
   *
   * @throws ConnectionError if unable to connect
   */
  initialize(): Promise<void>;

  /**
   * Gracefully shutdown database connections
   *
   * Should:
   * - Wait for in-flight queries to complete (up to timeout)
   * - Close all connections in the pool
   * - Release any held resources
   *
   * @param timeoutMs - Maximum wait time for graceful shutdown (default: 10 seconds)
   */
  shutdown(timeoutMs?: number): Promise<void>;

  /**
   * Check database connection health
   *
   * Used for:
   * - Kubernetes readiness/liveness probes
   * - Monitoring dashboards
   * - Connection pool diagnostics
   *
   * @returns Current health status with connection pool metrics
   */
  checkHealth(): Promise<ConnectionHealthStatus>;
}
