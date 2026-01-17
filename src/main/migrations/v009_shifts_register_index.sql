-- v009_shifts_register_index.sql
-- Add index for shift lookup by register
--
-- This migration adds an index to support the findOpenShiftByRegister() query
-- which is used to ensure only one open shift exists per register per day.
--
-- Security: DB-006 - Maintains store_id for tenant isolation
-- Security: SEC-006 - Index improves query performance

-- ============================================================================
-- Add index for register-specific open shift lookup
-- ============================================================================

-- Composite index for finding open shifts by store, date, and register
-- This covers the query: WHERE store_id = ? AND business_date = ? AND external_register_id = ? AND end_time IS NULL
CREATE INDEX IF NOT EXISTS idx_shifts_store_date_register_endtime
  ON shifts(store_id, business_date, external_register_id, end_time);
