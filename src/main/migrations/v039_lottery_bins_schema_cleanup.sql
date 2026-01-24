-- ============================================================================
-- Migration v039: Lottery Bins Schema Cleanup
-- ============================================================================
--
-- Purpose: Remove deprecated columns and align with cloud API schema.
-- The cloud schema uses: name, location, display_order, is_active
-- Local schema has legacy columns: label, bin_number, status
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. DROP: label column (replaced by name in v024)
-- 2. DROP: bin_number column (not in cloud schema)
-- 3. DROP: status column (replaced by is_active in v030)
--
-- Security Compliance:
-- - SEC-006: Migration uses table recreation pattern (no user input)
-- - DB-006: Store-scoped foreign keys preserved
--
-- Cloud Schema Alignment (schema.prisma lines 1817-1837):
-- - bin_id: TEXT PRIMARY KEY
-- - store_id: TEXT NOT NULL
-- - name: TEXT NOT NULL (was label in local)
-- - location: TEXT (optional)
-- - display_order: INTEGER DEFAULT 0
-- - is_active: BOOLEAN (was status='ACTIVE' in local)
-- - created_at: TEXT
-- - updated_at: TEXT
--
-- NOTE: SQLite does not support ALTER TABLE DROP COLUMN in older versions.
-- We must recreate the table to remove columns safely.
-- ============================================================================

-- Step 1: Create new table with aligned schema (cloud-compatible)
CREATE TABLE lottery_bins_new (
  bin_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,

  -- name: Display name for the bin (cloud schema primary identifier)
  -- Migrated from: label column (v024 added name and populated from label)
  name TEXT NOT NULL,

  -- location: Physical location description (e.g., "Front counter", "Register 2")
  location TEXT,

  -- display_order: Order for UI display sorting
  display_order INTEGER DEFAULT 0,

  -- is_active: Boolean (1=active, 0=inactive)
  -- Replaces: status column (ACTIVE/INACTIVE enum)
  is_active INTEGER NOT NULL DEFAULT 1,

  -- Soft delete support
  deleted_at TEXT,

  -- Cloud sync tracking
  synced_at TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data from old table with column mapping
-- Generates name from label or bin_number (name column may not exist from v024)
INSERT INTO lottery_bins_new (
  bin_id, store_id, name, location, display_order, is_active,
  deleted_at, synced_at, created_at, updated_at
)
SELECT
  bin_id,
  store_id,
  -- Generate name from label or bin_number (v024 may not have added name column)
  COALESCE(label, 'Bin ' || bin_number) AS name,
  NULL AS location,
  COALESCE(bin_number, 0) AS display_order,
  -- Derive is_active from status column
  CASE WHEN status = 'ACTIVE' OR status IS NULL THEN 1 ELSE 0 END AS is_active,
  deleted_at,
  synced_at,
  created_at,
  updated_at
FROM lottery_bins;

-- Step 3: Drop old table
DROP TABLE lottery_bins;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_bins_new RENAME TO lottery_bins;

-- Step 5: Recreate all indexes
-- Index for active bins lookup
CREATE INDEX idx_lottery_bins_active ON lottery_bins(store_id, is_active);

-- Index for display ordering (UI sorting)
CREATE INDEX idx_lottery_bins_display_order ON lottery_bins(store_id, display_order);

-- Index for name search
CREATE INDEX idx_lottery_bins_name ON lottery_bins(store_id, name);

-- Index for soft delete queries
CREATE INDEX idx_lottery_bins_deleted ON lottery_bins(deleted_at)
WHERE deleted_at IS NOT NULL;

-- Step 6: Drop the old triggers from v030 (no longer needed)
-- The status column is gone, so the sync triggers are obsolete
DROP TRIGGER IF EXISTS tr_lottery_bins_is_active_insert;
DROP TRIGGER IF EXISTS tr_lottery_bins_is_active_update;

-- Step 7: Create trigger to maintain updated_at timestamp
CREATE TRIGGER IF NOT EXISTS tr_lottery_bins_updated_at
AFTER UPDATE ON lottery_bins
FOR EACH ROW
BEGIN
  UPDATE lottery_bins SET updated_at = datetime('now')
  WHERE bin_id = NEW.bin_id;
END;

-- ============================================================================
-- End of Migration v039
-- ============================================================================
