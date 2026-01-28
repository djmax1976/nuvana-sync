-- ============================================================================
-- Migration v041: Remove cloud_department_id from departments
-- ============================================================================
--
-- Purpose: Align local departments schema by removing the redundant
-- cloud_department_id column and using the cloud's ID directly as the
-- primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for department_id and
-- storing the cloud's ID separately in cloud_department_id. This causes
-- sync issues where the cloud expects cloud IDs but local FKs use local IDs.
--
-- Changes:
-- 1. Update child table FKs to reference cloud_department_id values
-- 2. Copy cloud_department_id to department_id
-- 3. Drop cloud_department_id column
-- 4. Drop related index
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id column
--
-- ============================================================================

-- Step 1: Update child table (pos_department_mappings) to use cloud IDs
-- This ensures FK consistency before we change the parent table
UPDATE pos_department_mappings
SET department_id = (
  SELECT cloud_department_id
  FROM departments
  WHERE departments.department_id = pos_department_mappings.department_id
    AND departments.cloud_department_id IS NOT NULL
)
WHERE department_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM departments
    WHERE departments.department_id = pos_department_mappings.department_id
      AND departments.cloud_department_id IS NOT NULL
  );

-- Step 2: Copy cloud_department_id to department_id
-- Only update rows where cloud_department_id exists
UPDATE departments
SET department_id = cloud_department_id
WHERE cloud_department_id IS NOT NULL;

-- Step 3: Drop the cloud_department_id column
-- SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN
ALTER TABLE departments DROP COLUMN cloud_department_id;

-- Step 4: Drop the index on cloud_department_id (if exists)
DROP INDEX IF EXISTS idx_departments_cloud_id;

-- ============================================================================
-- End of Migration v041
-- ============================================================================
