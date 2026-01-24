-- ============================================================================
-- Migration v013: Drop Legacy Movement Tables
-- ============================================================================
--
-- This migration removes the legacy movement tables that have been replaced
-- by the new normalized schema introduced in v010_schema_alignment.sql.
--
-- Legacy Tables Being Dropped:
-- - fuel_grade_movements -> replaced by shift_fuel_summaries
-- - fuel_product_movements -> replaced by meter_readings
-- - miscellaneous_summaries -> (no replacement yet, data was not critical)
-- - merchandise_movements -> replaced by shift_department_summaries
-- - tax_level_movements -> replaced by shift_tax_summaries
-- - item_sales_movements -> aggregated into shift_department_summaries
-- - tender_product_movements -> replaced by tank_readings
--
-- WARNING: This migration is destructive. Ensure data has been migrated
-- to the new schema before running this migration.
-- ============================================================================

-- Drop legacy fuel grade movements table
-- Data now stored in: shift_fuel_summaries (via shift_summary_id)
DROP TABLE IF EXISTS fuel_grade_movements;

-- Drop legacy fuel product movements table
-- Data now stored in: meter_readings
DROP TABLE IF EXISTS fuel_product_movements;

-- Drop legacy miscellaneous summaries table
-- This data (payouts, safe drops, etc.) was not migrated to a new table
-- Future: Consider creating a new miscellaneous_transactions table if needed
DROP TABLE IF EXISTS miscellaneous_summaries;

-- Drop legacy merchandise movements table
-- Data now stored in: shift_department_summaries (via shift_summary_id)
DROP TABLE IF EXISTS merchandise_movements;

-- Drop legacy tax level movements table
-- Data now stored in: shift_tax_summaries (via shift_summary_id)
DROP TABLE IF EXISTS tax_level_movements;

-- Drop legacy item sales movements table
-- This detailed item-level data is now aggregated into shift_department_summaries
-- If item-level detail is needed, it can be stored in a new table
DROP TABLE IF EXISTS item_sales_movements;

-- Drop legacy tender product movements table
-- Data now stored in: tank_readings
DROP TABLE IF EXISTS tender_product_movements;

-- ============================================================================
-- Clean up any orphaned sync queue entries for legacy entity types
-- ============================================================================

DELETE FROM sync_queue WHERE entity_type IN (
  'fuel_grade_movement',
  'fuel_product_movement',
  'miscellaneous_summary',
  'merchandise_movement',
  'tax_level_movement',
  'item_sales_movement',
  'item_sales_movement_batch',
  'tender_product_movement'
);

-- ============================================================================
-- Update processed_files to remove references to legacy document types
-- (optional - these are just historical records)
-- ============================================================================

-- No action needed - processed_files records are historical and can remain
