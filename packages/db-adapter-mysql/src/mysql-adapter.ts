import type { Pool } from "mysql2/promise";
import type {
  DatabaseAdapter,
  EventRepository,
  EventService,
  MaintenanceOperations,
  ConnectionHealthStatus,
} from "@outboxy/db-adapter-core";
import { ConnectionError } from "@outboxy/db-adapter-core";
import type { MySQLAdapterConfig, Logger } from "./config.js";
import { MySQLAdapterConfigSchema, noopLogger } from "./config.js";
import { createPool, shutdownPool } from "./connection/mysql-pool.js";
import { MySQLEventRepository } from "./repositories/mysql-event.repository.js";
import { MySQLEventService } from "./repositories/mysql-event.service.js";
import { MySQLMaintenance } from "./repositories/mysql-maintenance.js";

/**
 * MySQL implementation of DatabaseAdapter
 *
 * Unified entry point for all database operations. Manages:
 * - Connection pool lifecycle
 * - Repository/service instantiation
 * - Health checks
 */
export class MySQLAdapter implements DatabaseAdapter {
  private pool: Pool | null = null;
  private _eventRepository: MySQLEventRepository | null = null;
  private _eventService: MySQLEventService | null = null;
  private _maintenance: MySQLMaintenance | null = null;
  private readonly logger: Logger;
  private readonly config: MySQLAdapterConfig;
  private initialized = false;

  constructor(config: MySQLAdapterConfig) {
    // Validate config with Zod
    const validated = MySQLAdapterConfigSchema.parse(config);
    this.config = { ...validated, logger: config.logger };
    this.logger = config.logger ?? noopLogger;
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn("MySQLAdapter already initialized");
      return;
    }

    this.pool = await createPool(this.config, this.logger);
    this._eventRepository = new MySQLEventRepository(this.pool);
    this._eventService = new MySQLEventService(this.pool);
    this._maintenance = new MySQLMaintenance(this.pool, this.logger);
    this.initialized = true;

    this.logger.info("MySQLAdapter initialized successfully");
  }

  /**
   * Gracefully shutdown database connections
   */
  async shutdown(timeoutMs = 10000): Promise<void> {
    if (!this.initialized || !this.pool) {
      this.logger.warn("MySQLAdapter not initialized, nothing to shutdown");
      return;
    }

    this.logger.info({ timeoutMs }, "Shutting down MySQLAdapter");

    await shutdownPool(this.pool, timeoutMs);

    this.pool = null;
    this._eventRepository = null;
    this._eventService = null;
    this._maintenance = null;
    this.initialized = false;

    this.logger.info("MySQLAdapter shutdown complete");
  }

  /**
   * Check database connection health
   *
   * Note: MySQL2 doesn't expose pool statistics through its public API,
   * so only the `healthy` status is returned (not metrics like connection counts).
   */
  async checkHealth(): Promise<ConnectionHealthStatus> {
    if (!this.pool) {
      return {
        healthy: false,
        error: "Adapter not initialized",
      };
    }

    try {
      const connection = await this.pool.getConnection();
      try {
        await connection.ping();
        return { healthy: true };
      } finally {
        connection.release();
      }
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get the underlying MySQL Pool for advanced operations
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
        "MySQLAdapter not initialized. Call initialize() first.",
      );
    }
  }
}
