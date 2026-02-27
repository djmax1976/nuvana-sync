-- v058_shifts_per_register_numbering.sql
-- Change shift numbering to be per-register instead of per-store-per-date
--
-- BUSINESS REQUIREMENT:
-- Each register should have independent shift numbering:
-- - Register 1: Shift 1, Shift 2, Shift 3
-- - Register 2: Shift 1, Shift 2, Shift 3
--
-- PREVIOUS BEHAVIOR:
-- Shift numbers were global per store per day:
-- - Store on date X: Shift 1, Shift 2, Shift 3 (regardless of register)
--
-- SECURITY: DB-006 - Maintains store_id in unique constraint for tenant isolation
-- SECURITY: SEC-006 - No dynamic SQL, schema change only

-- ============================================================================
-- Step 1: Drop the existing unique constraint
-- ============================================================================
-- Old constraint: UNIQUE(store_id, business_date, shift_number)
DROP INDEX IF EXISTS idx_shifts_unique;

-- ============================================================================
-- Step 2: Create new unique constraint with external_register_id
-- ============================================================================
-- New constraint: UNIQUE(store_id, business_date, external_register_id, shift_number)
--
-- NOTE: SQLite treats NULL as distinct in UNIQUE constraints.
-- This means shifts with NULL external_register_id can have:
-- - Multiple rows with the same (store_id, business_date, shift_number)
-- This is acceptable because:
-- 1. Manual mode ALWAYS provides externalRegisterId (required in ManualStartShiftSchema)
-- 2. NAXML mode extracts register from XML (required field in NAXML spec)
-- 3. Existing shifts with NULL register are legacy data from before register tracking
--
-- For proper enforcement, NULL registers are treated as a single "unknown" register.
-- The application layer (getNextShiftNumber) handles this by querying with IS NULL.
CREATE UNIQUE INDEX idx_shifts_unique ON shifts(store_id, business_date, external_register_id, shift_number);

-- ============================================================================
-- Step 3: Add index for efficient per-register shift queries
-- ============================================================================
-- This index supports the getNextShiftNumber query which now filters by register
CREATE INDEX IF NOT EXISTS idx_shifts_store_date_register
  ON shifts(store_id, business_date, external_register_id);
