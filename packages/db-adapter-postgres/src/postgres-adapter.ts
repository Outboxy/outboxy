import type { Pool } from "pg";
import type {
  DatabaseAdapter,
  EventRepository,
  EventService,
  MaintenanceOperations,
  ConnectionHealthStatus,
} from "@outboxy/db-adapter-core";
import { ConnectionError } from "@outboxy/db-adapter-core";
import type { PostgresAdapterConfig, Logger } from "./config.js";
import { PostgresAdapterConfigSchema, noopLogger } from "./config.js";
import { createPool, shutdownPool } from "./connection/pg-pool.js";
import { PgEventRepository } from "./repositories/pg-event.repository.js";
import { PgEventService } from "./repositories/pg-event.service.js";
import { PgMaintenance } from "./repositories/pg-maintenance.js";

/**
 * PostgreSQL implementation of DatabaseAdapter
 *
 * Unified entry point for all database operations. Manages:
 * - Connection pool lifecycle
 * - Repository/service instantiation
 * - Health checks
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;
  private _eventRepository: PgEventRepository | null = null;
  private _eventService: PgEventService | null = null;
  private _maintenance: PgMaintenance | null = null;
  private readonly logger: Logger;
  private readonly config: PostgresAdapterConfig;
  private initialized = false;

  constructor(config: PostgresAdapterConfig) {
    // Validate config with Zod
    const validated = PostgresAdapterConfigSchema.parse(config);
    this.config = { ...validated, logger: config.logger };
    this.logger = config.logger ?? noopLogger;
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn("PostgresAdapter already initialized");
      return;
    }

    this.pool = await createPool(this.config, this.logger);
    this._eventRepository = new PgEventRepository(this.pool);
    this._eventService = new PgEventService(this.pool);
    this._maintenance = new PgMaintenance(this.pool, this.logger);
    this.initialized = true;

    this.logger.info("PostgresAdapter initialized successfully");
  }

  /**
   * Gracefully shutdown database connections
   */
  async shutdown(timeoutMs = 10000): Promise<void> {
    if (!this.initialized || !this.pool) {
      this.logger.warn("PostgresAdapter not initialized, nothing to shutdown");
      return;
    }

    this.logger.info({ timeoutMs }, "Shutting down PostgresAdapter");

    await shutdownPool(this.pool, timeoutMs);

    this.pool = null;
    this._eventRepository = null;
    this._eventService = null;
    this._maintenance = null;
    this.initialized = false;

    this.logger.info("PostgresAdapter shutdown complete");
  }

  /**
   * Check database connection health
   */
  async checkHealth(): Promise<ConnectionHealthStatus> {
    if (!this.pool) {
      return {
        healthy: false,
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 0,
        error: "Adapter not initialized",
      };
    }

    try {
      const client = await this.pool.connect();
      try {
        await client.query("SELECT 1");
        return {
          healthy: true,
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
          waitingClients: this.pool.waitingCount,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      return {
        healthy: false,
        totalConnections: this.pool.totalCount,
        idleConnections: this.pool.idleCount,
        waitingClients: this.pool.waitingCount,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get the underlying pg Pool for advanced operations
   */
  getClient(): Pool {
    this.ensureInitialized();
    return this.pool!;
  }

  /**
   * Repository for worker operations
   */
  get eventRepository(): EventRepository {
    this.ensureInitialized();
    return this._eventRepository!;
  }

  /**
   * Service for API operations
   */
  get eventService(): EventService {
    this.ensureInitialized();
    return this._eventService!;
  }

  /**
   * Maintenance operations
   */
  get maintenance(): MaintenanceOperations {
    this.ensureInitialized();
    return this._maintenance!;
  }

  /**
   * Ensure adapter is initialized before accessing properties
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.pool) {
      throw new ConnectionError(
        "PostgresAdapter not initialized. Call initialize() first.",
      );
    }
  }
}
