import pino, { type DestinationStream } from "pino";

export type { Logger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerConfig {
  level?: LogLevel;
  service: string;
  version?: string;
  prettyPrint?: boolean;
}

/**
 * Create a configured Pino logger instance
 *
 * Features:
 * - Auto pretty-print in development (NODE_ENV !== 'production')
 * - JSON output in production (ELK/Loki compatible)
 * - Consistent base fields: service, version, ISO 8601 timestamps
 *
 * @example
 * const logger = createLogger({
 *   service: 'outboxy-api',
 *   level: 'info',
 *   version: '0.1.0'
 * });
 *
 * logger.info({ requestId: '123' }, 'Request received');
 */
export function createLogger(
  config: LoggerConfig,
  destination?: DestinationStream,
): pino.Logger {
  const isDevelopment =
    config.prettyPrint ?? process.env.NODE_ENV !== "production";
  const level = config.level ?? "info";

  const options: pino.LoggerOptions = {
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: config.service,
      version: config.version ?? process.env.npm_package_version ?? "unknown",
    },
  };

  // Transport and destination are mutually exclusive in Pino
  // If a destination is provided (for testing), skip transport
  if (!destination && isDevelopment) {
    options.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  return destination ? pino(options, destination) : pino(options);
}

/**
 * Create a minimal logger for early startup errors
 *
 * Used when config validation fails (before main logger is configured).
 * Reads LOG_LEVEL directly from environment with safe defaults.
 *
 * @example
 * try {
 *   config = parseConfig();
 * } catch (error) {
 *   const logger = createBootstrapLogger('outboxy-api');
 *   logger.fatal({ err: error }, 'Configuration validation failed');
 *   process.exit(1);
 * }
 */
export function createBootstrapLogger(service: string): pino.Logger {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const validLevels: LogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ];
  const level: LogLevel = validLevels.includes(envLevel as LogLevel)
    ? (envLevel as LogLevel)
    : "error";

  const isDevelopment = process.env.NODE_ENV !== "production";

  return pino({
    level,
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service,
      version: process.env.npm_package_version ?? "unknown",
    },
  });
}

/**
 * Create a silent logger for tests
 *
 * By default, logs nothing. Set TEST_LOG_LEVEL env to enable test logging.
 *
 * @example
 * // In test file
 * const logger = createTestLogger();
 *
 * // To debug tests, run with:
 * // TEST_LOG_LEVEL=debug npm test
 */
export function createTestLogger(): pino.Logger {
  const level = process.env.TEST_LOG_LEVEL ?? "silent";

  return pino({
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: "test",
    },
  });
}
