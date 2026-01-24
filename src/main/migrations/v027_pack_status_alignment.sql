-- ============================================================================
-- Migration v027: Pack Status Alignment
-- ============================================================================
--
-- Purpose: Align pack status values with cloud API schema
-- - ACTIVATED -> ACTIVE (pack is in use, being sold)
-- - SETTLED -> DEPLETED (pack finished, sold out)
-- - settled_at -> depleted_at (column rename)
--
-- This ensures consistent status values between desktop and cloud.
-- Reference: database-schema.md defines cloud enum as RECEIVED|ACTIVE|DEPLETED|RETURNED
--
-- NOTE: SQLite CHECK constraints cannot be modified in place.
-- We must recreate the table to change the allowed status values.
--
-- SEC-006: Data migration uses table recreation pattern
-- DB-006: Store-scoped data remains isolated
-- ============================================================================

-- Step 1: Create new table with updated schema
CREATE TABLE lottery_packs_new (
  pack_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES lottery_games(game_id),
  pack_number TEXT NOT NULL,
  bin_id TEXT REFERENCES lottery_bins(bin_id),
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK(status IN ('RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED')),
  received_at TEXT,
  received_by TEXT REFERENCES users(user_id),
  activated_at TEXT,
  activated_by TEXT REFERENCES users(user_id),
  depleted_at TEXT,
  returned_at TEXT,
  opening_serial TEXT,
  closing_serial TEXT,
  tickets_sold INTEGER NOT NULL DEFAULT 0 CHECK(tickets_sold >= 0),
  sales_amount REAL NOT NULL DEFAULT 0 CHECK(sales_amount >= 0),
  cloud_pack_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- v019 columns: shift tracking
  activated_shift_id TEXT REFERENCES shifts(shift_id),
  depleted_shift_id TEXT REFERENCES shifts(shift_id),
  returned_shift_id TEXT REFERENCES shifts(shift_id),
  depleted_by TEXT REFERENCES users(user_id),
  returned_by TEXT REFERENCES users(user_id),
  depletion_reason TEXT CHECK(depletion_reason IS NULL OR depletion_reason IN ('SHIFT_CLOSE', 'AUTO_REPLACED', 'MANUAL_SOLD_OUT', 'POS_LAST_TICKET')),
  -- v020 columns: return context
  return_reason TEXT CHECK(return_reason IS NULL OR return_reason IN ('SUPPLIER_RECALL', 'DAMAGED', 'EXPIRED', 'INVENTORY_ADJUSTMENT', 'STORE_CLOSURE', 'OTHER')),
  return_notes TEXT,
  last_sold_serial TEXT,
  tickets_sold_on_return INTEGER,
  return_sales_amount REAL,
  returned_day_id TEXT REFERENCES lottery_business_days(day_id),
  serial_start TEXT,
  serial_end TEXT,
  last_sold_at TEXT,
  -- Unique constraint: one pack number per game per store
  UNIQUE(store_id, game_id, pack_number)
);

-- Step 2: Copy data with status conversion
-- ACTIVATED -> ACTIVE, SETTLED -> DEPLETED, settled_at -> depleted_at
INSERT INTO lottery_packs_new (
  pack_id, store_id, game_id, pack_number, bin_id,
  status,
  received_at, received_by, activated_at, activated_by,
  depleted_at,
  returned_at, opening_serial, closing_serial,
  tickets_sold, sales_amount, cloud_pack_id, synced_at,
  created_at, updated_at,
  activated_shift_id, depleted_shift_id, returned_shift_id,
  depleted_by, returned_by, depletion_reason,
  return_reason, return_notes,
  last_sold_serial, tickets_sold_on_return, return_sales_amount,
  returned_day_id, serial_start, serial_end, last_sold_at
)
SELECT
  pack_id, store_id, game_id, pack_number, bin_id,
  CASE status
    WHEN 'ACTIVATED' THEN 'ACTIVE'
    WHEN 'SETTLED' THEN 'DEPLETED'
    ELSE status
  END,
  received_at, received_by, activated_at, activated_by,
  settled_at,
  returned_at, opening_serial, closing_serial,
  tickets_sold, sales_amount, cloud_pack_id, synced_at,
  created_at, updated_at,
  activated_shift_id, depleted_shift_id, returned_shift_id,
  depleted_by, returned_by, depletion_reason,
  return_reason, return_notes,
  last_sold_serial, tickets_sold_on_return, return_sales_amount,
  returned_day_id, serial_start, serial_end, last_sold_at
FROM lottery_packs;

-- Step 3: Drop old table
DROP TABLE lottery_packs;

-- Step 4: Rename new table
ALTER TABLE lottery_packs_new RENAME TO lottery_packs;

-- Step 5: Recreate indexes
CREATE INDEX idx_packs_store_status ON lottery_packs(store_id, status);
CREATE INDEX idx_packs_bin ON lottery_packs(bin_id);
CREATE INDEX idx_packs_game ON lottery_packs(game_id, status);
CREATE INDEX idx_packs_number ON lottery_packs(pack_number);
CREATE INDEX idx_lottery_packs_activated_shift ON lottery_packs(activated_shift_id);
CREATE INDEX idx_lottery_packs_depleted_shift ON lottery_packs(depleted_shift_id);
CREATE INDEX idx_lottery_packs_returned_shift ON lottery_packs(returned_shift_id);
CREATE INDEX idx_lottery_packs_depleted_by ON lottery_packs(depleted_by);
CREATE INDEX idx_lottery_packs_returned_by ON lottery_packs(returned_by);
CREATE INDEX idx_lottery_packs_return_reason ON lottery_packs(return_reason);
CREATE INDEX idx_lottery_packs_returned_day ON lottery_packs(returned_day_id);

-- Step 6: Update sync_queue payloads to use new status values
UPDATE sync_queue
SET payload = REPLACE(payload, '"status":"ACTIVATED"', '"status":"ACTIVE"')
WHERE entity_type = 'pack' AND payload LIKE '%"status":"ACTIVATED"%';

UPDATE sync_queue
SET payload = REPLACE(payload, '"status":"SETTLED"', '"status":"DEPLETED"')
WHERE entity_type = 'pack' AND payload LIKE '%"status":"SETTLED"%';

-- ============================================================================
-- End of Migration v027
-- ============================================================================
