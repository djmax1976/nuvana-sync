-- ============================================================================
-- Migration v034: Lottery Business Days API Field Alignment
-- ============================================================================
--
-- Purpose: Add day_summary_id field to align with cloud API schema.
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. ADD: day_summary_id (reference to cloud day summary record)
--
-- Security Compliance:
-- - SEC-006: No user input in migration
-- - DB-006: Store-scoped data integrity maintained
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - day_summary_id: Maps to BusinessDaySyncRecord.day_summary_id
--   Links to aggregated day summary statistics in cloud system
-- ============================================================================

-- Add day_summary_id column
-- This field links the local business day to a cloud day summary record
-- that contains aggregated statistics and KPIs
ALTER TABLE lottery_business_days ADD COLUMN day_summary_id TEXT;

-- Create index for day_summary_id lookups
-- Used when syncing day summary data from cloud
CREATE INDEX IF NOT EXISTS idx_lottery_business_days_summary ON lottery_business_days(day_summary_id);

-- ============================================================================
-- End of Migration v034
-- ============================================================================
