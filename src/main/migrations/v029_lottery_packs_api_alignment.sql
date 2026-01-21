-- ============================================================================
-- Migration v029: Lottery Packs API Field Alignment
-- ============================================================================
--
-- Purpose: Align lottery_packs table columns with cloud API schema to enable
-- seamless bidirectional sync without field name transformation.
--
-- Priority: P1 (Critical) - Required for API sync compatibility
--
-- Changes:
-- 1. RENAME: bin_id -> current_bin_id (matches API field name)
-- 2. RENAME: tickets_sold -> tickets_sold_count (matches API field name)
-- 3. ADD: serial_override_approved_by (manager who approved serial override)
-- 4. ADD: serial_override_reason (reason for serial override)
-- 5. ADD: mark_sold_approved_by (manager who approved pre-sold ticket marking)
-- 6. ADD: mark_sold_reason (reason for marking tickets as sold)
--
-- Security Compliance:
-- - SEC-006: Migration uses parameterized patterns where applicable
-- - DB-006: Store-scoped data integrity maintained via foreign keys
-- - Data migration preserves all existing records without loss
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - current_bin_id: Maps to LotteryPackSyncRecord.current_bin_id
-- - tickets_sold_count: Maps to LotteryPackSyncRecord.tickets_sold_count
-- - serial_override_approved_by: Maps to LotteryPackSyncRecord.serial_override_approved_by
-- - serial_override_reason: Maps to LotteryPackSyncRecord.serial_override_reason
-- - mark_sold_approved_by: Maps to LotteryPackSyncRecord.mark_sold_approved_by
-- - mark_sold_reason: Maps to LotteryPackSyncRecord.mark_sold_reason
--
-- NOTE: SQLite does not support ALTER TABLE RENAME COLUMN in older versions.
-- We must recreate the table to rename columns safely.
-- ============================================================================

-- Step 1: Create new table with aligned schema
CREATE TABLE lottery_packs_new (
  pack_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES lottery_games(game_id),
  pack_number TEXT NOT NULL,

  -- RENAMED: bin_id -> current_bin_id (API alignment)
  current_bin_id TEXT REFERENCES lottery_bins(bin_id),

  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK(status IN ('RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED')),

  -- Reception tracking
  received_at TEXT,
  received_by TEXT REFERENCES users(user_id),

  -- Activation tracking
  activated_at TEXT,
  activated_by TEXT REFERENCES users(user_id),
  activated_shift_id TEXT REFERENCES shifts(shift_id),

  -- Depletion tracking
  depleted_at TEXT,
  depleted_by TEXT REFERENCES users(user_id),
  depleted_shift_id TEXT REFERENCES shifts(shift_id),
  depletion_reason TEXT CHECK(depletion_reason IS NULL OR depletion_reason IN (
    'SHIFT_CLOSE', 'AUTO_REPLACED', 'MANUAL_SOLD_OUT', 'POS_LAST_TICKET'
  )),

  -- Return tracking
  returned_at TEXT,
  returned_by TEXT REFERENCES users(user_id),
  returned_shift_id TEXT REFERENCES shifts(shift_id),
  return_reason TEXT CHECK(return_reason IS NULL OR return_reason IN (
    'SUPPLIER_RECALL', 'DAMAGED', 'EXPIRED', 'INVENTORY_ADJUSTMENT', 'STORE_CLOSURE', 'OTHER'
  )),
  return_notes TEXT,
  returned_day_id TEXT REFERENCES lottery_business_days(day_id),

  -- Serial tracking
  opening_serial TEXT,
  closing_serial TEXT,
  serial_start TEXT,
  serial_end TEXT,
  last_sold_serial TEXT,
  last_sold_at TEXT,

  -- Sales tracking
  -- RENAMED: tickets_sold -> tickets_sold_count (API alignment)
  tickets_sold_count INTEGER NOT NULL DEFAULT 0 CHECK(tickets_sold_count >= 0),
  sales_amount REAL NOT NULL DEFAULT 0 CHECK(sales_amount >= 0),
  tickets_sold_on_return INTEGER,
  return_sales_amount REAL,

  -- NEW: Serial override approval fields (API alignment)
  -- Used when opening_serial is not "000" (pre-sold tickets scenario)
  serial_override_approved_by TEXT REFERENCES users(user_id),
  serial_override_reason TEXT,

  -- NEW: Mark sold approval fields (API alignment)
  -- Used when marking tickets as pre-sold during activation
  mark_sold_approved_by TEXT REFERENCES users(user_id),
  mark_sold_reason TEXT,

  -- Cloud sync tracking
  cloud_pack_id TEXT,
  synced_at TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Unique constraint: one pack number per game per store
  UNIQUE(store_id, game_id, pack_number)
);

-- Step 2: Copy data from old table with column mapping
-- Maps: bin_id -> current_bin_id, tickets_sold -> tickets_sold_count
INSERT INTO lottery_packs_new (
  pack_id, store_id, game_id, pack_number,
  current_bin_id,
  status,
  received_at, received_by,
  activated_at, activated_by, activated_shift_id,
  depleted_at, depleted_by, depleted_shift_id, depletion_reason,
  returned_at, returned_by, returned_shift_id, return_reason, return_notes,
  opening_serial, closing_serial,
  serial_start, serial_end, last_sold_serial, last_sold_at,
  tickets_sold_count,
  sales_amount,
  tickets_sold_on_return, return_sales_amount,
  cloud_pack_id, synced_at,
  created_at, updated_at
)
SELECT
  pack_id, store_id, game_id, pack_number,
  bin_id,                    -- Maps to current_bin_id
  status,
  received_at, received_by,
  activated_at, activated_by, activated_shift_id,
  depleted_at, depleted_by, depleted_shift_id, depletion_reason,
  returned_at, returned_by, returned_shift_id, return_reason, return_notes,
  opening_serial, closing_serial,
  serial_start, serial_end, last_sold_serial, last_sold_at,
  tickets_sold,              -- Maps to tickets_sold_count
  sales_amount,
  tickets_sold_on_return, return_sales_amount,
  cloud_pack_id, synced_at,
  created_at, updated_at
FROM lottery_packs;

-- Step 3: Drop old table
DROP TABLE lottery_packs;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_packs_new RENAME TO lottery_packs;

-- Step 5: Recreate all indexes with updated column names
-- Performance: Indexed columns for common query patterns

-- Primary query pattern: Find packs by store and status
CREATE INDEX idx_packs_store_status ON lottery_packs(store_id, status);

-- Bin inventory queries: Find pack in specific bin
-- UPDATED: Uses current_bin_id (renamed from bin_id)
CREATE INDEX idx_packs_current_bin ON lottery_packs(current_bin_id);

-- Game-specific pack queries
CREATE INDEX idx_packs_game ON lottery_packs(game_id, status);

-- Pack number search (frequently used in UI)
CREATE INDEX idx_packs_number ON lottery_packs(pack_number);

-- Shift-level audit queries (v019 schema)
CREATE INDEX idx_lottery_packs_activated_shift ON lottery_packs(activated_shift_id);
CREATE INDEX idx_lottery_packs_depleted_shift ON lottery_packs(depleted_shift_id);
CREATE INDEX idx_lottery_packs_returned_shift ON lottery_packs(returned_shift_id);

-- User audit queries
CREATE INDEX idx_lottery_packs_activated_by ON lottery_packs(activated_by);
CREATE INDEX idx_lottery_packs_depleted_by ON lottery_packs(depleted_by);
CREATE INDEX idx_lottery_packs_returned_by ON lottery_packs(returned_by);

-- Return context queries (v020 schema)
CREATE INDEX idx_lottery_packs_return_reason ON lottery_packs(return_reason);
CREATE INDEX idx_lottery_packs_returned_day ON lottery_packs(returned_day_id);

-- Cloud sync lookup
CREATE INDEX idx_lottery_packs_cloud_id ON lottery_packs(cloud_pack_id);

-- Step 6: Update sync_queue payloads to use new field names
-- Updates any queued sync records to use the API-aligned names
UPDATE sync_queue
SET payload = REPLACE(payload, '"bin_id":', '"current_bin_id":')
WHERE entity_type = 'pack' AND payload LIKE '%"bin_id":%';

UPDATE sync_queue
SET payload = REPLACE(payload, '"tickets_sold":', '"tickets_sold_count":')
WHERE entity_type = 'pack' AND payload LIKE '%"tickets_sold":%';

-- ============================================================================
-- End of Migration v029
-- ============================================================================
