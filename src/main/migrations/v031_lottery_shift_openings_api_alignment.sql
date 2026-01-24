-- ============================================================================
-- Migration v031: Lottery Shift Openings API Field Alignment
-- ============================================================================
--
-- Purpose: Rename serial_number to opening_serial to align with cloud API schema.
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. RENAME: serial_number -> opening_serial (matches API field name)
--
-- Security Compliance:
-- - SEC-006: Migration uses table recreation pattern (no user input)
-- - DB-006: Store-scoped foreign keys preserved
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - opening_serial: Maps to ShiftOpeningSyncRecord.opening_serial
--
-- NOTE: SQLite does not support ALTER TABLE RENAME COLUMN in older versions.
-- We must recreate the table to rename columns safely.
-- ============================================================================

-- Step 1: Create new table with renamed column
CREATE TABLE lottery_shift_openings_new (
  opening_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL REFERENCES shifts(shift_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),

  -- RENAMED: serial_number -> opening_serial (API alignment)
  opening_serial TEXT NOT NULL,

  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data with column mapping
INSERT INTO lottery_shift_openings_new (
  opening_id, store_id, shift_id, pack_id,
  opening_serial,
  recorded_at, recorded_by, created_at
)
SELECT
  opening_id, store_id, shift_id, pack_id,
  serial_number,  -- Maps to opening_serial
  recorded_at, recorded_by, created_at
FROM lottery_shift_openings;

-- Step 3: Drop old table
DROP TABLE lottery_shift_openings;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_shift_openings_new RENAME TO lottery_shift_openings;

-- Step 5: Recreate indexes
CREATE INDEX idx_lottery_openings_shift ON lottery_shift_openings(shift_id);
CREATE INDEX idx_lottery_openings_pack ON lottery_shift_openings(pack_id);

-- Step 6: Update sync_queue payloads to use new field name
UPDATE sync_queue
SET payload = REPLACE(payload, '"serial_number":', '"opening_serial":')
WHERE entity_type = 'shift_opening' AND payload LIKE '%"serial_number":%';

-- ============================================================================
-- End of Migration v031
-- ============================================================================
