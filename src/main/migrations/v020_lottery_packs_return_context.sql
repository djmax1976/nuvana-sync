-- ============================================================================
-- Migration v020: Add return context columns to lottery_packs
-- ============================================================================
--
-- Purpose: Align local schema with cloud schema for pack return operations
-- This enables full audit trail and reporting for pack returns.
--
-- Priority: P2 (High) - Required for return reason tracking and compliance
--
-- Business Requirements:
-- - Track why packs were returned (recall, damage, expiration, etc.)
-- - Store notes for "OTHER" return reasons
-- - Track return-time sales for partial packs
-- - Link returns to business days for reporting
--
-- Security Compliance:
-- - SEC-006: All queries using these columns must use parameterized statements
-- - SEC-010: AUTHZ - Audit trail fields for return operations
-- - DB-006: Columns reference related tables for referential integrity
--
-- Cloud Schema Alignment:
-- - return_reason: Maps to cloud LotteryPackReturnReason enum
-- - return_notes: Maps to cloud LotteryPack.return_notes
-- - last_sold_serial: Maps to cloud LotteryPack.last_sold_serial
-- - tickets_sold_on_return: Maps to cloud LotteryPack.tickets_sold_on_return
-- - return_sales_amount: Maps to cloud LotteryPack.return_sales_amount
-- - returned_day_id: Maps to cloud LotteryPack.returned_day_id
-- ============================================================================

-- === Return reason (LotteryPackReturnReason enum) ===
-- Values align with cloud enum for sync compatibility
-- SUPPLIER_RECALL: Supplier/lottery commission recalled the pack
-- DAMAGED: Pack was physically damaged and cannot be sold
-- EXPIRED: Pack expired before being fully sold
-- INVENTORY_ADJUSTMENT: Inventory correction/audit adjustment
-- STORE_CLOSURE: Store closing or relocating
-- OTHER: Other reason (requires return_notes)
ALTER TABLE lottery_packs ADD COLUMN return_reason TEXT
  CHECK(return_reason IS NULL OR return_reason IN ('SUPPLIER_RECALL', 'DAMAGED', 'EXPIRED', 'INVENTORY_ADJUSTMENT', 'STORE_CLOSURE', 'OTHER'));

-- === Return notes (required when return_reason = 'OTHER') ===
-- Free-text field for additional context on returns
ALTER TABLE lottery_packs ADD COLUMN return_notes TEXT;

-- === Sales tracking at time of return ===
-- For partially-sold packs that are returned, track:
-- - last_sold_serial: The last ticket serial that was sold before return
-- - tickets_sold_on_return: Number of tickets sold before return
-- - return_sales_amount: Total sales amount at time of return
ALTER TABLE lottery_packs ADD COLUMN last_sold_serial TEXT;
ALTER TABLE lottery_packs ADD COLUMN tickets_sold_on_return INTEGER;
ALTER TABLE lottery_packs ADD COLUMN return_sales_amount REAL;

-- === Link to business day when return occurred ===
-- Enables day-level return reporting and variance calculation
ALTER TABLE lottery_packs ADD COLUMN returned_day_id TEXT REFERENCES lottery_business_days(day_id);

-- === Serial tracking fields from cloud schema ===
-- serial_start: Original starting serial number of pack (from lottery commission)
-- serial_end: Original ending serial number of pack (from lottery commission)
-- last_sold_at: Timestamp of last ticket sale (for real-time tracking)
ALTER TABLE lottery_packs ADD COLUMN serial_start TEXT;
ALTER TABLE lottery_packs ADD COLUMN serial_end TEXT;
ALTER TABLE lottery_packs ADD COLUMN last_sold_at TEXT;

-- === Indexes for return-related queries ===
-- Support efficient filtering by return reason and day
CREATE INDEX idx_lottery_packs_return_reason ON lottery_packs(return_reason);
CREATE INDEX idx_lottery_packs_returned_day ON lottery_packs(returned_day_id);
