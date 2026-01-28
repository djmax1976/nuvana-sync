-- ============================================================================
-- Migration v042: Remove cloud_tender_id from tenders
-- ============================================================================
--
-- Purpose: Align local tenders schema by removing the redundant
-- cloud_tender_id column and using the cloud's ID directly as the
-- primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for tender_id and
-- storing the cloud's ID separately in cloud_tender_id. This causes
-- sync issues where the cloud expects cloud IDs but local FKs use local IDs.
--
-- Changes:
-- 1. Update child table FKs to reference cloud_tender_id values
-- 2. Copy cloud_tender_id to tender_id
-- 3. Drop cloud_tender_id column
-- 4. Drop related index
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id column
--
-- ============================================================================

-- Step 1: Update child table (pos_tender_mappings) to use cloud IDs
-- This ensures FK consistency before we change the parent table
UPDATE pos_tender_mappings
SET tender_id = (
  SELECT cloud_tender_id
  FROM tenders
  WHERE tenders.tender_id = pos_tender_mappings.tender_id
    AND tenders.cloud_tender_id IS NOT NULL
)
WHERE tender_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM tenders
    WHERE tenders.tender_id = pos_tender_mappings.tender_id
      AND tenders.cloud_tender_id IS NOT NULL
  );

-- Step 2: Copy cloud_tender_id to tender_id
-- Only update rows where cloud_tender_id exists
UPDATE tenders
SET tender_id = cloud_tender_id
WHERE cloud_tender_id IS NOT NULL;

-- Step 3: Drop the cloud_tender_id column
-- SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN
ALTER TABLE tenders DROP COLUMN cloud_tender_id;

-- Step 4: Drop the index on cloud_tender_id (if exists)
DROP INDEX IF EXISTS idx_tenders_cloud_id;

-- ============================================================================
-- End of Migration v042
-- ============================================================================
