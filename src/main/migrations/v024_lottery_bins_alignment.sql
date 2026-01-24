-- ============================================================================
-- Migration v024: Align lottery_bins with cloud schema
-- ============================================================================
--
-- Purpose: Add missing fields from cloud LotteryBin model
--
-- Priority: P3 (Medium) - Bin metadata enhancements
--
-- Cloud Schema Alignment:
-- - name: Display name for the bin (cloud uses this instead of label)
-- - location: Physical location description
-- - display_order: Order for UI display sorting
-- ============================================================================

-- === Bin metadata fields ===
-- name: Display name (cloud schema uses this as primary identifier)
ALTER TABLE lottery_bins ADD COLUMN name TEXT;

-- location: Physical location description (e.g., "Front counter", "Register 2")
ALTER TABLE lottery_bins ADD COLUMN location TEXT;

-- display_order: Order for UI sorting (default 0)
ALTER TABLE lottery_bins ADD COLUMN display_order INTEGER DEFAULT 0;

-- === Populate name from existing label or bin_number ===
-- This ensures backward compatibility with existing data
UPDATE lottery_bins SET name = COALESCE(label, 'Bin ' || bin_number)
WHERE name IS NULL;

-- === Index for display ordering ===
CREATE INDEX idx_lottery_bins_display_order ON lottery_bins(store_id, display_order);
