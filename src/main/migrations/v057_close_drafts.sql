-- Migration v057: Close Drafts Table
--
-- Creates storage for draft data during Day Close and Shift Close wizards.
-- Drafts persist wizard state to SQLite, enabling crash recovery and
-- preventing data loss when the app closes unexpectedly.
--
-- Feature: DRAFT-001 (Draft-Backed Wizard Architecture)
--
-- Draft Types:
--   - DAY_CLOSE: 3-step wizard (Lottery → Reports → Review)
--   - SHIFT_CLOSE: 2-step wizard (Reports → Close Shift)
--
-- Status Lifecycle:
--   IN_PROGRESS → FINALIZING → FINALIZED
--   IN_PROGRESS → EXPIRED (abandoned drafts)
--
-- Security Compliance:
--   - SEC-006: All DAL queries use parameterized statements (enforced in DAL layer)
--   - DB-006: Tenant isolation via store_id on all records and in all queries
--   - DB-003: Version field for optimistic locking prevents lost updates
--   - API-001: Zod validation on all IPC inputs (enforced in handler layer)
--
-- Performance Considerations:
--   - Composite index on (store_id, shift_id) for common query pattern
--   - Status index for cleanup queries targeting EXPIRED drafts
--   - Payload stored as JSON TEXT for flexible schema evolution
--
-- @version 057
-- @date 2026-02-21
-- @feature DRAFT-001

-- ============================================================================
-- Create close_drafts table
-- ============================================================================
-- Stores wizard draft data as a working copy until finalization.
-- Data flows: React state → Draft (autosave) → Final tables (finalize)

CREATE TABLE IF NOT EXISTS close_drafts (
    -- Primary identifier (UUID)
    draft_id TEXT PRIMARY KEY NOT NULL,

    -- DB-006: Tenant isolation - store_id required for all queries
    store_id TEXT NOT NULL,

    -- Reference to the shift being closed
    -- One draft per shift at a time (enforced via UNIQUE constraint)
    shift_id TEXT NOT NULL,

    -- Business date context (ISO 8601 format: YYYY-MM-DD)
    business_date TEXT NOT NULL,

    -- Draft type determines wizard flow
    -- DAY_CLOSE: Lottery scanning required (3 steps)
    -- SHIFT_CLOSE: No lottery step (2 steps)
    draft_type TEXT NOT NULL CHECK(draft_type IN ('DAY_CLOSE', 'SHIFT_CLOSE')),

    -- Draft status for lifecycle management
    -- IN_PROGRESS: User actively working on wizard
    -- FINALIZING: Commit transaction in progress (lock state)
    -- FINALIZED: Successfully committed to final tables
    -- EXPIRED: Abandoned draft, can be cleaned up
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'FINALIZING', 'FINALIZED', 'EXPIRED')),

    -- Last completed step for crash recovery navigation
    -- Null means wizard just started, no steps completed
    -- LOTTERY: Step 1 completed (Day Close only)
    -- REPORTS: Step 2 completed (both wizards)
    -- REVIEW: Final review step reached (Day Close only)
    step_state TEXT CHECK(step_state IS NULL OR step_state IN ('LOTTERY', 'REPORTS', 'REVIEW')),

    -- JSON payload containing all wizard data
    -- Structure varies by draft_type:
    -- - lottery?: { bins_scans[], totals, entry_method, authorized_by? }
    -- - reports?: { lottery_reports?, gaming_reports?, vendor_invoices[], cash_payouts? }
    -- - closing_cash?: number
    payload TEXT NOT NULL DEFAULT '{}',

    -- Optimistic locking version for concurrent access control
    -- DB-003: Incremented on each update, checked before writes
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),

    -- Audit timestamps (ISO 8601 format)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- User who created the draft (SEC-010: Audit trail)
    created_by TEXT NOT NULL,

    -- Foreign key constraints
    -- Store must exist (tenant validation)
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,

    -- Shift must exist (referential integrity)
    -- Note: References shifts table (shift_id is PK there)
    FOREIGN KEY (shift_id) REFERENCES shifts(shift_id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query pattern: Find active draft for a shift within a store
-- DB-006: Includes store_id for tenant-isolated queries
-- Supports: getActiveDraft(storeId, shiftId)
CREATE INDEX IF NOT EXISTS idx_drafts_store_shift
ON close_drafts(store_id, shift_id);

-- Status-based queries for lifecycle management
-- Supports: Cleanup of EXPIRED drafts, finding IN_PROGRESS drafts
CREATE INDEX IF NOT EXISTS idx_drafts_status
ON close_drafts(status);

-- Efficient lookup for draft expiration/cleanup queries
-- Supports: cleanupExpiredDrafts(maxAgeHours) with date filtering
CREATE INDEX IF NOT EXISTS idx_drafts_store_status_updated
ON close_drafts(store_id, status, updated_at);

-- ============================================================================
-- Unique Constraints
-- ============================================================================

-- Only one active (IN_PROGRESS or FINALIZING) draft per shift per store
-- This prevents multiple concurrent editing sessions for the same shift
-- Note: FINALIZED and EXPIRED drafts are retained for audit but don't block new drafts
-- The DAL layer must check for active drafts before creating new ones

-- ============================================================================
-- End of Migration v057
-- ============================================================================
