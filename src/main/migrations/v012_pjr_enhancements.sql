-- v012_pjr_enhancements.sql
-- Enhancements for POSJournal (PJR) transaction parsing
--
-- This migration adds:
-- 1. Line item type column to distinguish fuel vs merchandise
-- 2. Line status for voided/cancelled items
-- 3. Fuel-specific columns for transaction_line_items
-- 4. Change amount for transaction_payments
-- 5. Transaction-level tax summary table
-- 6. Additional transaction fields from PJR
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity

-- ============================================================================
-- Transaction Line Items Enhancements
-- ============================================================================

-- Add line_type to distinguish fuel from merchandise
ALTER TABLE transaction_line_items ADD COLUMN line_type TEXT DEFAULT 'merchandise'
  CHECK(line_type IN ('fuel', 'merchandise', 'prepay'));

-- Add line_status for item-level status (normal, void, cancel, refund)
ALTER TABLE transaction_line_items ADD COLUMN line_status TEXT DEFAULT 'normal'
  CHECK(line_status IN ('normal', 'void', 'cancel', 'refund'));

-- Add fuel-specific fields (nullable for merchandise lines)
ALTER TABLE transaction_line_items ADD COLUMN fuel_grade_id TEXT;
ALTER TABLE transaction_line_items ADD COLUMN fuel_position_id TEXT;
ALTER TABLE transaction_line_items ADD COLUMN service_level TEXT CHECK(service_level IS NULL OR service_level IN ('self', 'full', 'mini'));
ALTER TABLE transaction_line_items ADD COLUMN actual_price REAL;
ALTER TABLE transaction_line_items ADD COLUMN entry_method TEXT;

-- Add tax_level_id for line-item tax reference
ALTER TABLE transaction_line_items ADD COLUMN tax_level_id TEXT;

-- ============================================================================
-- Transaction Payments Enhancements
-- ============================================================================

-- Add change_amount for tracking change given
ALTER TABLE transaction_payments ADD COLUMN change_amount REAL DEFAULT 0;

-- Add tender_sub_code for detailed tender type (e.g., visa, mc)
ALTER TABLE transaction_payments ADD COLUMN tender_sub_code TEXT;

-- ============================================================================
-- Transaction Enhancements
-- ============================================================================

-- Add fields from POSJournal
ALTER TABLE transactions ADD COLUMN event_sequence_id INTEGER;
ALTER TABLE transactions ADD COLUMN training_mode INTEGER DEFAULT 0 CHECK(training_mode IN (0, 1));
ALTER TABLE transactions ADD COLUMN outside_sale INTEGER DEFAULT 0 CHECK(outside_sale IN (0, 1));
ALTER TABLE transactions ADD COLUMN offline INTEGER DEFAULT 0 CHECK(offline IN (0, 1));
ALTER TABLE transactions ADD COLUMN suspended INTEGER DEFAULT 0 CHECK(suspended IN (0, 1));
ALTER TABLE transactions ADD COLUMN till_id TEXT;
ALTER TABLE transactions ADD COLUMN receipt_time TEXT;
ALTER TABLE transactions ADD COLUMN event_start_time TEXT;
ALTER TABLE transactions ADD COLUMN event_end_time TEXT;

-- Transaction totals from summary
ALTER TABLE transactions ADD COLUMN gross_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN net_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN tax_exempt_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN direction TEXT DEFAULT 'Collected' CHECK(direction IN ('Collected', 'Refunded'));

-- Linked transaction info
ALTER TABLE transactions ADD COLUMN linked_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN link_reason TEXT;

-- ============================================================================
-- Transaction Tax Summaries
-- ============================================================================

-- New table for transaction-level tax breakdown (from TransactionTax elements)
CREATE TABLE IF NOT EXISTS transaction_tax_summaries (
  tax_summary_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  tax_level_id TEXT NOT NULL,
  taxable_sales_amount REAL NOT NULL DEFAULT 0,
  tax_collected_amount REAL NOT NULL DEFAULT 0,
  taxable_sales_refunded_amount REAL NOT NULL DEFAULT 0,
  tax_refunded_amount REAL NOT NULL DEFAULT 0,
  tax_exempt_sales_amount REAL NOT NULL DEFAULT 0,
  tax_exempt_sales_refunded_amount REAL NOT NULL DEFAULT 0,
  tax_forgiven_sales_amount REAL NOT NULL DEFAULT 0,
  tax_forgiven_sales_refunded_amount REAL NOT NULL DEFAULT 0,
  tax_forgiven_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for transaction_tax_summaries
CREATE INDEX IF NOT EXISTS idx_tax_summaries_transaction ON transaction_tax_summaries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tax_summaries_store ON transaction_tax_summaries(store_id);
CREATE INDEX IF NOT EXISTS idx_tax_summaries_level ON transaction_tax_summaries(tax_level_id);

-- ============================================================================
-- Indexes for New Columns
-- ============================================================================

-- Index for fuel line queries
CREATE INDEX IF NOT EXISTS idx_line_items_fuel ON transaction_line_items(store_id, fuel_grade_id);

-- Index for fuel position analysis
CREATE INDEX IF NOT EXISTS idx_line_items_position ON transaction_line_items(store_id, fuel_position_id);

-- Index for line status queries (voided items)
CREATE INDEX IF NOT EXISTS idx_line_items_status ON transaction_line_items(store_id, line_status);

-- Index for line type queries
CREATE INDEX IF NOT EXISTS idx_line_items_type ON transaction_line_items(store_id, line_type);

-- Index for till analysis
CREATE INDEX IF NOT EXISTS idx_transactions_till ON transactions(store_id, till_id);
