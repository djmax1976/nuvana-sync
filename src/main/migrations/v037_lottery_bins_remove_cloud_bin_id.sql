-- ============================================================================
-- Migration v037: Remove cloud_bin_id from lottery_bins
-- ============================================================================
--
-- Purpose: Align local lottery_bins schema with cloud schema by removing the
-- redundant cloud_bin_id column and using the cloud's bin_id directly as
-- the primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for bin_id and storing
-- the cloud's ID separately in cloud_bin_id. This caused FK constraint failures
-- when syncing lottery_packs which reference the cloud's bin_id in current_bin_id.
--
-- Changes:
-- 1. Create new table with cloud_bin_id removed
-- 2. Copy data, using cloud_bin_id as the new bin_id (where available)
-- 3. Drop old table and rename new table
-- 4. Recreate indexes and triggers (from v030)
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id column
--
-- Performance:
-- - Recreates indexes for optimal query performance
-- - Uses indexed columns in all operations
--
-- Rollback:
-- - Not recommended; would require re-sync from cloud
-- - Backup database before running migration
--
-- ============================================================================

-- Step 1: Drop triggers that depend on the old table (from v030)
DROP TRIGGER IF EXISTS tr_lottery_bins_is_active_insert;
DROP TRIGGER IF EXISTS tr_lottery_bins_is_active_update;

-- Step 2: Create new table without cloud_bin_id column
-- Schema matches cloud LotteryBin model
CREATE TABLE lottery_bins_new (
  bin_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  bin_number INTEGER NOT NULL CHECK(bin_number > 0),
  label TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  is_active INTEGER DEFAULT 1,
  deleted_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one bin number per store
  UNIQUE(store_id, bin_number)
);

-- Step 3: Copy data from old table
-- Use cloud_bin_id as the new bin_id (this is the fix)
-- For any rows without cloud_bin_id, keep existing bin_id (edge case for local-only bins)
INSERT INTO lottery_bins_new (
  bin_id,
  store_id,
  bin_number,
  label,
  status,
  is_active,
  deleted_at,
  synced_at,
  created_at,
  updated_at
)
SELECT
  COALESCE(cloud_bin_id, bin_id),  -- Use cloud_bin_id as bin_id
  store_id,
  bin_number,
  label,
  status,
  is_active,
  deleted_at,
  synced_at,
  created_at,
  updated_at
FROM lottery_bins;

-- Step 4: Update lottery_packs to reference the new bin_id values
-- This ensures FK consistency: packs that reference old bin_id now reference cloud_bin_id
UPDATE lottery_packs
SET current_bin_id = (
  SELECT COALESCE(cloud_bin_id, bin_id)
  FROM lottery_bins
  WHERE lottery_bins.bin_id = lottery_packs.current_bin_id
)
WHERE current_bin_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_bins
    WHERE lottery_bins.bin_id = lottery_packs.current_bin_id
  );

-- Step 5: Drop old table
DROP TABLE lottery_bins;

-- Step 6: Rename new table
ALTER TABLE lottery_bins_new RENAME TO lottery_bins;

-- Step 7: Recreate indexes for query performance
-- Index for active bins (original from v003)
CREATE INDEX idx_lottery_bins_active ON lottery_bins(store_id, status, deleted_at);

-- Index for is_active queries (from v030)
CREATE INDEX idx_lottery_bins_is_active ON lottery_bins(store_id, is_active);

-- Index for bin_number lookup
CREATE INDEX idx_lottery_bins_number ON lottery_bins(store_id, bin_number);

-- Step 8: Recreate triggers to keep is_active in sync with status (from v030)
CREATE TRIGGER tr_lottery_bins_is_active_insert
AFTER INSERT ON lottery_bins
FOR EACH ROW
BEGIN
  UPDATE lottery_bins
  SET is_active = CASE WHEN NEW.status = 'ACTIVE' THEN 1 ELSE 0 END
  WHERE bin_id = NEW.bin_id;
END;

CREATE TRIGGER tr_lottery_bins_is_active_update
AFTER UPDATE OF status ON lottery_bins
FOR EACH ROW
BEGIN
  UPDATE lottery_bins
  SET is_active = CASE WHEN NEW.status = 'ACTIVE' THEN 1 ELSE 0 END
  WHERE bin_id = NEW.bin_id;
END;

-- ============================================================================
-- End of Migration v037
-- ============================================================================
