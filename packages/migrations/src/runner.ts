import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, readdirSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Dialect = "postgresql" | "postgres" | "mysql";

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  lastApplied: string | null;
}

/**
 * Get the current migration status
 *
 * Returns information about applied and pending migrations.
 *
 * @param connectionString - Database connection string
 * @param dialect - Database dialect (defaults to "postgresql")
 * @returns Migration status object
 *
 * @example
 * ```typescript
 * const status = await getMigrationStatus(process.env.DATABASE_URL);
 * console.log(`Applied: ${status.applied.length}, Pending: ${status.pending.length}`);
 * ```
 */
export async function getMigrationStatus(
  connectionString: string,
  dialect: Dialect = "postgresql",
): Promise<MigrationStatus> {
  const normalizedDialect = dialect === "postgres" ? "postgresql" : dialect;

  if (normalizedDialect === "postgresql") {
    return getPostgresMigrationStatus(connectionString);
  } else if (normalizedDialect === "mysql") {
    return getMySQLMigrationStatus(connectionString);
  } else {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
}

async function getPostgresMigrationStatus(
  connectionString: string,
): Promise<MigrationStatus> {
  const pool = new Pool({ connectionString });

  try {
    // Check if migration tracking table exists
    const tableExistsResult = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '__outboxy_migrations'
      ) as exists
    `);

    const exists = tableExistsResult.rows[0]?.exists ?? false;

    if (!exists) {
      return {
        applied: [],
        pending: getAllMigrationNames(),
        lastApplied: null,
      };
    }

    // Get applied migrations
    const appliedResult = await pool.query(`
      SELECT name, applied_at
      FROM __outboxy_migrations
      ORDER BY applied_at DESC
    `);

    const applied = appliedResult.rows.map((row) => row.name);
    const allMigrations = getAllMigrationNames();
    const pending = allMigrations.filter((name) => !applied.includes(name));
    const lastApplied = applied[0] || null;

    return {
      applied,
      pending,
      lastApplied,
    };
  } finally {
    await pool.end();
  }
}

async function getMySQLMigrationStatus(
  connectionString: string,
): Promise<MigrationStatus> {
  const { createPool } = await import("mysql2/promise");

  const url = new URL(connectionString);
  const pool = createPool({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
  });

  try {
    // Check if migration tracking table exists
    const [tableExistsResult] = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      AND table_name = '__outboxy_migrations'
    `);

    interface CountRow {
      count: number;
    }
    const rows = tableExistsResult as CountRow[];
    const exists = rows.length > 0 && rows[0]!.count > 0;

    if (!exists) {
      return {
        applied: [],
        pending: getAllMigrationNames(),
        lastApplied: null,
      };
    }

    // Get applied migrations
    const [appliedResult] = await pool.query(
      "SELECT name, applied_at FROM __outboxy_migrations ORDER BY applied_at DESC",
    );

    interface MigrationRow {
      name: string;
      applied_at: Date;
    }
    const applied = (appliedResult as MigrationRow[]).map((row) => row.name);
    const allMigrations = getAllMigrationNames();
    const pending = allMigrations.filter((name) => !applied.includes(name));
    const lastApplied = applied[0] || null;

    return {
      applied,
      pending,
      lastApplied,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Run database migrations
 *
 * Applies all pending migrations to bring the database schema up to date.
 * Supports PostgreSQL and MySQL using raw SQL files.
 *
 * @param connectionString - Database connection string
 * @param dialect - Database dialect (defaults to "postgresql")
 *
 * @example
 * ```typescript
 * // PostgreSQL
 * await runMigrations(process.env.DATABASE_URL);
 * await runMigrations(process.env.DATABASE_URL, "postgresql");
 *
 * // MySQL
 * await runMigrations(process.env.MYSQL_URL, "mysql");
 * ```
 */
export async function runMigrations(
  connectionString: string,
  dialect: Dialect = "postgresql",
): Promise<void> {
  // Normalize postgres alias to postgresql
  const normalizedDialect = dialect === "postgres" ? "postgresql" : dialect;

  if (normalizedDialect === "postgresql") {
    await runPostgresMigrations(connectionString);
  } else if (normalizedDialect === "mysql") {
    await runMySQLMigrations(connectionString);
  } else {
    throw new Error(`Unsupported dialect: ${dialect}`);
  }
}

const MIGRATION_PATTERN = /^\d{3}_[a-z_]+\.sql$/;

function getAllMigrationNames(): string[] {
  const sqlDir = path.join(__dirname, "sql/postgres");
  return readdirSync(sqlDir)
    .filter((f) => MIGRATION_PATTERN.test(f))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""));
}

/**
 * Run PostgreSQL migrations using raw SQL
 */
async function runPostgresMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });

  try {
    console.log("Running PostgreSQL migrations...");

    // Create migration tracking table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS __outboxy_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Check which migrations have already been applied
    const { rows } = await pool.query("SELECT name FROM __outboxy_migrations");
    const applied = new Set(rows.map((r) => r.name));

    // Find SQL files
    const sqlDir = path.join(__dirname, "sql/postgres");
    const migrations = getAllMigrationNames();

    // Run migrations that haven't been applied yet
    for (const migrationName of migrations) {
      if (applied.has(migrationName)) {
        continue;
      }

      const migrationFile = `${migrationName}.sql`;
      const migrationPath = path.join(sqlDir, migrationFile);

      // Check if file exists
      if (!existsSync(migrationPath)) {
        throw new Error(
          `PostgreSQL migration file not found: ${migrationPath}`,
        );
      }

      const migrationSQL = readFileSync(migrationPath, "utf8");

      // Run migration in a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migrationSQL);
        await client.query(
          "INSERT INTO __outboxy_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
          [migrationName],
        );
        await client.query("COMMIT");
        console.log(`Applied migration: ${migrationName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    console.log("PostgreSQL migrations completed successfully");
  } catch (error) {
    console.error("PostgreSQL migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Run MySQL migrations using SQL files
 */
async function runMySQLMigrations(connectionString: string): Promise<void> {
  const { createPool } = await import("mysql2/promise");

  // Parse connection string to get connection details
  const url = new URL(connectionString);
  const pool = createPool({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading slash
    multipleStatements: true,
  });

  try {
    console.log("Running MySQL migrations...");

    // Create migration tracking table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS __outboxy_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check which migrations have already been applied
    const [appliedMigrations] = await pool.query(
      "SELECT name FROM __outboxy_migrations",
    );
    interface MigrationRow {
      name: string;
    }
    const applied = new Set(
      (appliedMigrations as MigrationRow[]).map((row) => row.name),
    );

    // Find SQL files
    const sqlDir = path.join(__dirname, "sql/mysql");
    const migrations = getAllMigrationNames();

    // Run migrations that haven't been applied yet
    for (const migrationName of migrations) {
      if (applied.has(migrationName)) {
        continue;
      }

      const migrationFile = `${migrationName}.sql`;
      const migrationPath = path.join(sqlDir, migrationFile);

      // Check if file exists
      if (!existsSync(migrationPath)) {
        throw new Error(`MySQL migration file not found: ${migrationPath}`);
      }

      const migrationSQL = readFileSync(migrationPath, "utf8");

      try {
        await pool.query(migrationSQL);
      } catch (error: unknown) {
        // Ignore duplicate key errors (race condition when multiple packages run in parallel)
        if ((error as { code?: string }).code !== "ER_DUP_KEYNAME") {
          throw error;
        }
        // If indexes already exist, that's fine - another package created them
      }

      // Use INSERT IGNORE to handle race conditions when multiple packages run in parallel
      await pool.query(
        "INSERT IGNORE INTO __outboxy_migrations (name) VALUES (?)",
        [migrationName],
      );

      console.log(`Applied migration: ${migrationName}`);
    }

    console.log("MySQL migrations completed successfully");
  } catch (error) {
    console.error("MySQL migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * CLI entrypoint for running migrations
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx src/runner.ts
 *   # or
 *   pnpm migrate
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable not set");
    console.error("\nUsage:");
    console.error(
      "  DATABASE_URL=postgresql://user:pass@host:port/db tsx src/runner.ts",
    );
    console.error("  # or");
    console.error(
      "  DATABASE_URL=postgresql://user:pass@host:port/db pnpm migrate",
    );
    process.exit(1);
  }

  runMigrations(connectionString)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
