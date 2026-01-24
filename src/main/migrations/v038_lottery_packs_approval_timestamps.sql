-- ============================================================================
-- Migration v038: Lottery Packs Approval Timestamp Fields
-- ============================================================================
--
-- Purpose: Add missing approval timestamp fields to align with cloud API schema.
-- The cloud schema has serial_override_approved_at and mark_sold_approved_at
-- fields that were missed in v029 migration.
--
-- Priority: P1 (Critical) - Required for API sync compatibility
--
-- Changes:
-- 1. ADD: serial_override_approved_at (timestamp for serial override approval)
-- 2. ADD: mark_sold_approved_at (timestamp for mark sold approval)
--
-- Security Compliance:
-- - SEC-006: Migration uses ALTER TABLE (no user input)
-- - DB-006: Store-scoped data integrity maintained
--
-- Cloud Schema Alignment (schema.prisma lines 1758-1765):
-- - serial_override_approved_at: DateTime? - When serial override was approved
-- - mark_sold_approved_at: DateTime? - When mark sold was approved
--
-- NOTE: These fields complement the existing *_approved_by fields added in v029.
-- The timestamps provide audit trail for when approvals occurred.
-- ============================================================================

-- Step 1: Add serial_override_approved_at column
-- Tracks when manager approved a serial number override
-- Used with serial_override_approved_by for complete audit trail
ALTER TABLE lottery_packs ADD COLUMN serial_override_approved_at TEXT;

-- Step 2: Add mark_sold_approved_at column
-- Tracks when manager approved marking tickets as pre-sold
-- Used with mark_sold_approved_by for complete audit trail
ALTER TABLE lottery_packs ADD COLUMN mark_sold_approved_at TEXT;

-- Step 3: Create index for serial override approval queries
-- Useful for audit reports of serial override approvals
CREATE INDEX IF NOT EXISTS idx_lottery_packs_serial_override_at
ON lottery_packs(serial_override_approved_at)
WHERE serial_override_approved_at IS NOT NULL;

-- Step 4: Create index for mark sold approval queries
-- Useful for audit reports of mark sold approvals
CREATE INDEX IF NOT EXISTS idx_lottery_packs_mark_sold_at
ON lottery_packs(mark_sold_approved_at)
WHERE mark_sold_approved_at IS NOT NULL;

-- ============================================================================
-- End of Migration v038
-- ============================================================================
