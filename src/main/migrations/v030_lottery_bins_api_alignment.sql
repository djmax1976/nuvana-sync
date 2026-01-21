-- ============================================================================
-- Migration v030: Lottery Bins API Field Alignment
-- ============================================================================
--
-- Purpose: Add is_active computed column to align with cloud API schema.
-- The cloud API uses is_active (boolean) while local uses status (enum).
-- This migration adds is_active as a generated column for API compatibility.
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. ADD: is_active INTEGER (boolean 0/1, computed from status)
--
-- Security Compliance:
-- - SEC-006: No user input in migration
-- - DB-006: Store-scoped data integrity maintained
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - is_active: Maps to LotteryBinSyncRecord.is_active (boolean)
--
-- NOTE: SQLite supports generated columns since version 3.31.0 (2020-01-22).
-- For maximum compatibility, we use a regular column with a trigger to maintain it.
-- ============================================================================

-- Step 1: Add is_active column (stores 1 for ACTIVE, 0 for INACTIVE)
ALTER TABLE lottery_bins ADD COLUMN is_active INTEGER DEFAULT 1;

-- Step 2: Initialize is_active based on current status values
UPDATE lottery_bins
SET is_active = CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END;

-- Step 3: Create trigger to keep is_active in sync with status on INSERT
CREATE TRIGGER IF NOT EXISTS tr_lottery_bins_is_active_insert
AFTER INSERT ON lottery_bins
FOR EACH ROW
BEGIN
  UPDATE lottery_bins
  SET is_active = CASE WHEN NEW.status = 'ACTIVE' THEN 1 ELSE 0 END
  WHERE bin_id = NEW.bin_id;
END;

-- Step 4: Create trigger to keep is_active in sync with status on UPDATE
CREATE TRIGGER IF NOT EXISTS tr_lottery_bins_is_active_update
AFTER UPDATE OF status ON lottery_bins
FOR EACH ROW
BEGIN
  UPDATE lottery_bins
  SET is_active = CASE WHEN NEW.status = 'ACTIVE' THEN 1 ELSE 0 END
  WHERE bin_id = NEW.bin_id;
END;

-- Step 5: Create index for is_active queries (frequently used in API responses)
CREATE INDEX IF NOT EXISTS idx_lottery_bins_is_active ON lottery_bins(store_id, is_active);

-- ============================================================================
-- End of Migration v030
-- ============================================================================
