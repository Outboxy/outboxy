-- Outboxy Database Schema - Table Definitions
-- MySQL DDL for manual installation
--
-- Usage:
--   mysql -u user -p database < 001_create_tables.sql
--   mysql -u user -p database < 002_create_indexes.sql
--
-- Or run both:
--   cat sql/mysql/*.sql | mysql -u user -p database

-- =============================================================================
-- outbox_config: Dynamic configuration storage
-- =============================================================================
CREATE TABLE IF NOT EXISTS `outbox_config` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(255) NOT NULL,
    `value` JSON NOT NULL,
    `description` TEXT,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    `updated_by` VARCHAR(255),
    UNIQUE KEY `outbox_config_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- outbox_events: Main transactional outbox table
-- =============================================================================
CREATE TABLE IF NOT EXISTS `outbox_events` (
    -- Primary identifier (MySQL uses CHAR(36) for UUIDs)
    `id` CHAR(36) NOT NULL PRIMARY KEY,

    -- Event metadata
    `aggregate_type` VARCHAR(255) NOT NULL,
    `aggregate_id` VARCHAR(255) NOT NULL,
    `event_type` VARCHAR(255) NOT NULL,
    `event_version` INT DEFAULT 1 NOT NULL,

    -- Payload (MySQL JSON type)
    `payload` JSON NOT NULL,
    `headers` JSON DEFAULT (JSON_OBJECT()),

    -- Destination
    `destination_url` VARCHAR(1000) NOT NULL,
    `destination_type` VARCHAR(50) DEFAULT 'http' NOT NULL,

    -- Idempotency
    `idempotency_key` VARCHAR(255),

    -- Status tracking
    `status` VARCHAR(50) DEFAULT 'pending' NOT NULL,

    -- Retry logic
    `retry_count` INT DEFAULT 0 NOT NULL,
    `max_retries` INT DEFAULT 5 NOT NULL,
    `next_retry_at` TIMESTAMP NULL,
    `backoff_multiplier` DECIMAL(3, 2) DEFAULT 2.0,

    -- Error tracking
    `last_error` VARCHAR(1000),
    `error_details` JSON,

    -- Timestamps
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    `processing_started_at` TIMESTAMP NULL,
    `processed_at` TIMESTAMP NULL,

    -- Metadata (can store tracing info like trace_id, span_id)
    `metadata` JSON DEFAULT (JSON_OBJECT()),

    -- Worker identification
    `processed_by_worker` VARCHAR(255),

    -- Soft delete
    `deleted_at` TIMESTAMP NULL,

    -- Partition key (MySQL 8.0+ generated column)
    `created_date` DATE AS (DATE(`created_at`)) STORED,

    -- Check constraints (MySQL 8.0.16+)
    CONSTRAINT `check_status` CHECK (`status` IN ('pending', 'processing', 'succeeded', 'failed', 'dlq', 'cancelled')),
    CONSTRAINT `check_retry_count` CHECK (`retry_count` >= 0),
    CONSTRAINT `check_destination_type` CHECK (`destination_type` IN ('http', 'kafka', 'sqs', 'rabbitmq', 'pubsub'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
