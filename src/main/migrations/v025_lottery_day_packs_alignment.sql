-- ============================================================================
-- Migration v025: Align lottery_day_packs with cloud schema
-- ============================================================================
--
-- Purpose: Add entry_method field from cloud LotteryDayPack model
--
-- Priority: P3 (Medium) - Day pack entry method tracking
--
-- Cloud Schema Alignment:
-- - entry_method: How the serial data was entered (SCAN or MANUAL)
-- ============================================================================

-- === Entry method tracking ===
-- SCAN: Serial was scanned from barcode (automated, trusted)
-- MANUAL: Serial was manually typed by user
-- This helps with audit and variance investigation
ALTER TABLE lottery_day_packs ADD COLUMN entry_method TEXT
  CHECK(entry_method IS NULL OR entry_method IN ('SCAN', 'MANUAL'));

-- === Index for entry method queries ===
-- Useful for finding manual entries during audit
CREATE INDEX idx_lottery_day_packs_entry_method ON lottery_day_packs(entry_method)
  WHERE entry_method = 'MANUAL';
