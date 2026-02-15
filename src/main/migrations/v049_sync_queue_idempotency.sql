-- v049_sync_queue_idempotency.sql
-- Phase 2: Transactional Outbox and Queue Integrity
--
-- Adds idempotency key support for the sync queue to prevent duplicate
-- entries and enable deterministic deduplication.
--
-- Security: MQ-001 - Idempotency for message consumers
-- Security: SEC-006 - Parameterized queries in DAL (enforced in code)
-- Security: DB-006 - store_id included in idempotency key scope

-- ============================================================================
-- Add Idempotency Key Column
-- ============================================================================

-- Idempotency key is a deterministic hash of entity_type + entity_id + operation
-- This allows the same operation to be safely re-attempted without creating duplicates
ALTER TABLE sync_queue ADD COLUMN idempotency_key TEXT;

-- ============================================================================
-- Create Unique Index for Idempotency
-- ============================================================================

-- UNIQUE constraint on (store_id, idempotency_key) with partial index
-- Only applies to pending (synced = 0) and non-dead-lettered items
-- This allows the same key to be reused after an item is synced or dead-lettered
CREATE UNIQUE INDEX idx_sync_queue_idempotency
  ON sync_queue(store_id, idempotency_key)
  WHERE synced = 0 AND dead_lettered = 0 AND idempotency_key IS NOT NULL;

-- ============================================================================
-- Performance Index for Idempotency Key Lookup
-- ============================================================================

-- Index for fast idempotency key lookup during enqueue
CREATE INDEX idx_sync_queue_idempotency_lookup
  ON sync_queue(idempotency_key, synced, dead_lettered);

-- ============================================================================
-- Backfill Idempotency Keys for Existing Records (Optional)
-- ============================================================================

-- Generate idempotency keys for existing pending records
-- Format: entity_type:entity_id:operation (hashed via application layer)
-- Note: This leaves idempotency_key NULL for existing records which is safe
-- because the unique constraint only applies to non-NULL values
