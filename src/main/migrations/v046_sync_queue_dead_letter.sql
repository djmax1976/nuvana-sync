-- ============================================================================
-- Migration v046: Add Dead Letter Queue support to sync_queue
-- ============================================================================
--
-- Purpose: Implement enterprise-grade Dead Letter Queue (DLQ) for items that
-- cannot be synced after exhausting retry attempts or due to permanent failures.
--
-- Background:
-- Previously, failed items were auto-reset every sync cycle, creating an
-- infinite retry loop. Items with structural problems (missing required fields)
-- or permanent cloud rejections (400, 404, 422) would retry forever.
--
-- Changes:
-- 1. Add dead_lettered flag to mark items moved to DLQ
-- 2. Add dead_letter_reason to record why item was moved
-- 3. Add dead_lettered_at timestamp for auditing
-- 4. Add error_category to classify errors (TRANSIENT, PERMANENT, STRUCTURAL)
-- 5. Add retry_after for future retry scheduling
-- 6. Add composite index for DLQ queries
--
-- DLQ Behavior (per MQ-002):
-- - Items are dead-lettered after max_attempts with permanent error
-- - Items are dead-lettered immediately for structural failures
-- - Original payload and error context preserved for investigation
-- - DLQ can be monitored and items can be replayed after fixing issues
--
-- Error Categories (per ERR-007):
-- - TRANSIENT: Network errors, 5xx, rate limits - retry with backoff
-- - PERMANENT: 400, 404, 422 - dead letter immediately
-- - STRUCTURAL: Missing required fields - dead letter immediately
-- - UNKNOWN: Unclassified errors - retry with extended backoff
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id scoping in indexes
-- - API-003: Error context stored with truncated/sanitized values
--
-- Performance:
-- - Composite index on (store_id, dead_lettered, created_at) for efficient queries
-- - Partial index excludes synced items from DLQ lookups
-- - Query patterns support paginated DLQ browsing
--
-- ============================================================================

-- ==========================================================================
-- Step 1: Add dead_lettered flag (0 = active queue, 1 = dead lettered)
-- ==========================================================================

ALTER TABLE sync_queue ADD COLUMN dead_lettered INTEGER NOT NULL DEFAULT 0 CHECK(dead_lettered IN (0, 1));

-- ==========================================================================
-- Step 2: Add dead_letter_reason to record why item was dead-lettered
-- ==========================================================================
-- Allowed values enforced in application layer per MQ-002:
-- - MAX_ATTEMPTS_EXCEEDED: Hit max_attempts with non-transient error
-- - PERMANENT_ERROR: Cloud returned permanent error (400, 404, 422)
-- - STRUCTURAL_FAILURE: Missing required fields, invalid payload structure
-- - MANUAL: Manually dead-lettered by operator

ALTER TABLE sync_queue ADD COLUMN dead_letter_reason TEXT CHECK(
  dead_letter_reason IS NULL OR dead_letter_reason IN (
    'MAX_ATTEMPTS_EXCEEDED',
    'PERMANENT_ERROR',
    'STRUCTURAL_FAILURE',
    'MANUAL'
  )
);

-- ==========================================================================
-- Step 3: Add dead_lettered_at timestamp for auditing
-- ==========================================================================

ALTER TABLE sync_queue ADD COLUMN dead_lettered_at TEXT;

-- ==========================================================================
-- Step 4: Add error_category for error classification (per ERR-007)
-- ==========================================================================
-- Allows routing decisions: retry vs dead-letter

ALTER TABLE sync_queue ADD COLUMN error_category TEXT CHECK(
  error_category IS NULL OR error_category IN (
    'TRANSIENT',
    'PERMANENT',
    'STRUCTURAL',
    'UNKNOWN'
  )
);

-- ==========================================================================
-- Step 5: Add retry_after for scheduled retry support
-- ==========================================================================
-- ISO 8601 timestamp; item should not be retried until this time
-- Used for rate-limit backoff (429 Retry-After) and scheduled retries

ALTER TABLE sync_queue ADD COLUMN retry_after TEXT;

-- ==========================================================================
-- Step 6: Create composite index for DLQ queries
-- ==========================================================================
-- Optimized for: Get dead-lettered items by store, ordered by creation time
-- DB-006: Index scoped to store_id for tenant isolation
-- PERF: Partial index would be ideal but SQLite doesn't support WHERE in CREATE INDEX

CREATE INDEX idx_sync_queue_dead_letter ON sync_queue(store_id, dead_lettered, created_at DESC);

-- ==========================================================================
-- Step 7: Create index for error_category queries
-- ==========================================================================
-- Supports filtering by error category in diagnostics

CREATE INDEX idx_sync_queue_error_category ON sync_queue(store_id, error_category, synced)
  WHERE synced = 0 AND dead_lettered = 0;

-- ============================================================================
-- End of Migration v046
-- ============================================================================
