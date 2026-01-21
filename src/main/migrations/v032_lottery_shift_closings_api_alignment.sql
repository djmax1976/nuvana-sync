-- ============================================================================
-- Migration v032: Lottery Shift Closings API Field Alignment
-- ============================================================================
--
-- Purpose: Rename serial_number to closing_serial to align with cloud API schema.
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. RENAME: serial_number -> closing_serial (matches API field name)
--
-- Security Compliance:
-- - SEC-006: Migration uses table recreation pattern (no user input)
-- - DB-006: Store-scoped foreign keys preserved
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - closing_serial: Maps to ShiftClosingSyncRecord.closing_serial
--
-- NOTE: SQLite does not support ALTER TABLE RENAME COLUMN in older versions.
-- We must recreate the table to rename columns safely.
-- ============================================================================

-- Step 1: Create new table with renamed column
-- Includes all columns from v022 migration (cashier_id, entry_method, manual auth fields)
CREATE TABLE lottery_shift_closings_new (
  closing_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL REFERENCES shifts(shift_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),

  -- RENAMED: serial_number -> closing_serial (API alignment)
  closing_serial TEXT NOT NULL,

  tickets_sold INTEGER CHECK(tickets_sold >= 0),
  sales_amount REAL CHECK(sales_amount >= 0),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- v022 columns: dual-auth and entry method fields
  cashier_id TEXT REFERENCES users(user_id),
  entry_method TEXT CHECK(entry_method IS NULL OR entry_method IN ('SCAN', 'MANUAL')),
  manual_entry_authorized_by TEXT REFERENCES users(user_id),
  manual_entry_authorized_at TEXT
);

-- Step 2: Copy data with column mapping
INSERT INTO lottery_shift_closings_new (
  closing_id, store_id, shift_id, pack_id,
  closing_serial,
  tickets_sold, sales_amount, recorded_at, recorded_by, created_at,
  cashier_id, entry_method, manual_entry_authorized_by, manual_entry_authorized_at
)
SELECT
  closing_id, store_id, shift_id, pack_id,
  serial_number,  -- Maps to closing_serial
  tickets_sold, sales_amount, recorded_at, recorded_by, created_at,
  cashier_id, entry_method, manual_entry_authorized_by, manual_entry_authorized_at
FROM lottery_shift_closings;

-- Step 3: Drop old table
DROP TABLE lottery_shift_closings;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_shift_closings_new RENAME TO lottery_shift_closings;

-- Step 5: Recreate indexes
CREATE INDEX idx_lottery_closings_shift ON lottery_shift_closings(shift_id);
CREATE INDEX idx_lottery_closings_pack ON lottery_shift_closings(pack_id);
CREATE INDEX idx_lottery_closings_cashier ON lottery_shift_closings(cashier_id);
CREATE INDEX idx_lottery_closings_manual_auth ON lottery_shift_closings(manual_entry_authorized_by);
CREATE INDEX idx_lottery_closings_entry_method ON lottery_shift_closings(entry_method)
  WHERE entry_method = 'MANUAL';

-- Step 6: Update sync_queue payloads to use new field name
UPDATE sync_queue
SET payload = REPLACE(payload, '"serial_number":', '"closing_serial":')
WHERE entity_type = 'shift_closing' AND payload LIKE '%"serial_number":%';

-- ============================================================================
-- End of Migration v032
-- ============================================================================
