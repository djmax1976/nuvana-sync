-- ============================================================================
-- Migration v026: Align lottery_variances with cloud schema
-- ============================================================================
--
-- Purpose: Add shift_id field from cloud LotteryVariance model
-- The cloud schema tracks variance at shift level, while local uses day_id.
-- This migration adds shift_id to support both granularities.
--
-- Priority: P3 (Medium) - Variance tracking enhancement
--
-- Cloud Schema Alignment:
-- - shift_id: Link variance to specific shift (cloud primary key)
-- Note: Local schema uses day_id; both are now supported
-- ============================================================================

-- === Add shift-level variance tracking ===
-- shift_id allows variance to be tracked at shift granularity
-- This aligns with cloud schema which uses shift_id
-- Existing day_id is retained for backward compatibility
ALTER TABLE lottery_variances ADD COLUMN shift_id TEXT REFERENCES shifts(shift_id);

-- === Index for shift-level variance queries ===
CREATE INDEX idx_lottery_variances_shift ON lottery_variances(shift_id);
