-- ============================================================================
-- Migration v052: Add CONFLICT error category and CONFLICT_ERROR dead letter reason
-- ============================================================================
--
-- Purpose: Align database CHECK constraints with Phase 4 (D4.2) TypeScript types
-- that introduced CONFLICT handling for HTTP 409 errors.
--
-- Root Cause (SYNC-5002):
-- TypeScript ErrorCategory type includes 'CONFLICT' for handling 409 errors,
-- but v046 migration only defined: TRANSIENT, PERMANENT, STRUCTURAL, UNKNOWN.
-- This mismatch causes CHECK constraint violations when the error classifier
-- categorizes errors as CONFLICT.
--
-- Changes:
-- 1. Add 'CONFLICT' to error_category CHECK constraint
-- 2. Add 'CONFLICT_ERROR' to dead_letter_reason CHECK constraint
--
-- SQLite Limitation:
-- SQLite does not support ALTER COLUMN or modifying CHECK constraints directly.
-- The standard pattern is to recreate the table with corrected constraints.
--
-- Error Categories (per ERR-007, Phase 4 D4.2):
-- - TRANSIENT: Network errors, 5xx, rate limits - retry with backoff
-- - PERMANENT: 400, 404, 422 - dead letter after max attempts
-- - STRUCTURAL: Missing required fields - dead letter immediately
-- - CONFLICT: 409 duplicate/conflict - limited retries, then dead letter (NEW)
-- - UNKNOWN: Unclassified errors - retry with extended backoff
--
-- Dead Letter Reasons (per MQ-002, Phase 4 D4.2):
-- - MAX_ATTEMPTS_EXCEEDED: Hit max_attempts with non-transient error
-- - PERMANENT_ERROR: Cloud returned permanent error (400, 404, 422)
-- - STRUCTURAL_FAILURE: Missing required fields, invalid payload structure
-- - CONFLICT_ERROR: Duplicate/conflict error (409) (NEW)
-- - MANUAL: Manually dead-lettered by operator
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id in table and indexes
-- - API-003: Error context preserved for investigation
--
-- Performance:
-- - All existing indexes recreated with identical definitions
-- - Partial indexes preserved for optimal query performance
-- - Data copy is a single atomic transaction
--
-- Rollback:
-- This migration can be rolled back by reversing the process:
-- recreate sync_queue without CONFLICT/CONFLICT_ERROR values.
-- Note: Any records with CONFLICT/CONFLICT_ERROR would need data cleanup first.
--
-- ============================================================================

-- ==========================================================================
-- Step 1: Create new table with corrected CHECK constraints
-- ==========================================================================
-- Complete schema including all columns from v028, v040, v046, and v049

CREATE TABLE sync_queue_new (
  -- Core fields (v002/v028)
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE')),
  payload TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sync_error TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT,

  -- API context fields (v040)
  sync_direction TEXT NOT NULL DEFAULT 'PUSH' CHECK(sync_direction IN ('PUSH', 'PULL')),
  api_endpoint TEXT,
  http_status INTEGER,
  response_body TEXT,

  -- Dead letter queue fields (v046) - CORRECTED CONSTRAINTS
  dead_lettered INTEGER NOT NULL DEFAULT 0 CHECK(dead_lettered IN (0, 1)),
  dead_letter_reason TEXT CHECK(
    dead_letter_reason IS NULL OR dead_letter_reason IN (
      'MAX_ATTEMPTS_EXCEEDED',
      'PERMANENT_ERROR',
      'STRUCTURAL_FAILURE',
      'CONFLICT_ERROR',  -- ADDED: Phase 4 D4.2 support
      'MANUAL'
    )
  ),
  dead_lettered_at TEXT,
  error_category TEXT CHECK(
    error_category IS NULL OR error_category IN (
      'TRANSIENT',
      'PERMANENT',
      'STRUCTURAL',
      'CONFLICT',  -- ADDED: Phase 4 D4.2 support for 409 errors
      'UNKNOWN'
    )
  ),
  retry_after TEXT,

  -- Idempotency field (v049)
  idempotency_key TEXT,

  -- Foreign key constraint
  FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
);

-- ==========================================================================
-- Step 2: Copy all data from existing table
-- ==========================================================================
-- Column order must match exactly between tables

INSERT INTO sync_queue_new (
  id, store_id, entity_type, entity_id, operation, payload,
  priority, synced, sync_attempts, max_attempts, last_sync_error,
  last_attempt_at, created_at, synced_at,
  sync_direction, api_endpoint, http_status, response_body,
  dead_lettered, dead_letter_reason, dead_lettered_at, error_category,
  retry_after, idempotency_key
)
SELECT
  id, store_id, entity_type, entity_id, operation, payload,
  priority, synced, sync_attempts, max_attempts, last_sync_error,
  last_attempt_at, created_at, synced_at,
  sync_direction, api_endpoint, http_status, response_body,
  dead_lettered, dead_letter_reason, dead_lettered_at, error_category,
  retry_after, idempotency_key
FROM sync_queue;

-- ==========================================================================
-- Step 3: Drop old table
-- ==========================================================================

DROP TABLE sync_queue;

-- ==========================================================================
-- Step 4: Rename new table to original name
-- ==========================================================================

ALTER TABLE sync_queue_new RENAME TO sync_queue;

-- ==========================================================================
-- Step 5: Recreate all indexes
-- ==========================================================================
-- Indexes from v028, v040, v046, and v049 migrations

-- Basic operational indexes (v028)
CREATE INDEX idx_sync_queue_store_synced ON sync_queue(store_id, synced);
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
CREATE INDEX idx_sync_queue_created ON sync_queue(created_at);

-- Direction-based filtering for Sync Monitor (v040)
-- DB-006: Scoped by store_id for tenant isolation
CREATE INDEX idx_sync_queue_direction ON sync_queue(store_id, sync_direction, created_at DESC);

-- Dead letter queue queries (v046)
-- Optimized for: Get dead-lettered items by store, ordered by creation time
CREATE INDEX idx_sync_queue_dead_letter ON sync_queue(store_id, dead_lettered, created_at DESC);

-- Error category filtering (v046)
-- Partial index for active items only (synced = 0, dead_lettered = 0)
CREATE INDEX idx_sync_queue_error_category ON sync_queue(store_id, error_category, synced)
  WHERE synced = 0 AND dead_lettered = 0;

-- Idempotency enforcement (v049)
-- UNIQUE constraint for deduplication of pending items
CREATE UNIQUE INDEX idx_sync_queue_idempotency
  ON sync_queue(store_id, idempotency_key)
  WHERE synced = 0 AND dead_lettered = 0 AND idempotency_key IS NOT NULL;

-- Idempotency lookup optimization (v049)
CREATE INDEX idx_sync_queue_idempotency_lookup
  ON sync_queue(idempotency_key, synced, dead_lettered);

-- ============================================================================
-- End of Migration v052
-- ============================================================================
