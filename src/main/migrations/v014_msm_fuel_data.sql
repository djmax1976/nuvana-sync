-- v014_msm_fuel_data.sql
-- MSM Fuel Data Schema Enhancement
--
-- Purpose: Add support for MiscellaneousSummaryMovement (MSM) fuel data parsing
-- which provides accurate inside/outside fuel sales breakdown.
--
-- Key findings from MSM analysis:
-- - MSM Period 1 (Daily) files contain complete fuel data with volume breakdown
-- - MSM Period 98 (Shift) files contain shift-specific data
-- - MiscellaneousSummaryCount holds gallons (not transaction count) for fuel entries
-- - Inside + Outside fuel totals = Daily grand total matching PDF reports
--
-- Security: DB-006 - All tables include store_id or parent FK for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity

-- ============================================================================
-- STEP 1: Add MSM-specific columns to shift_fuel_summaries
-- ============================================================================

-- Add fuel_source to track where data came from (FGM vs MSM)
ALTER TABLE shift_fuel_summaries ADD COLUMN fuel_source TEXT DEFAULT 'FGM'
  CHECK(fuel_source IN ('FGM', 'MSM', 'PJR', 'MANUAL'));

-- Add inside/outside breakdown columns for MSM Period 98 data
-- Note: For shift-level data, inside_volume/inside_amount track inside (cash) fuel
-- and outside_volume/outside_amount track outside (credit/debit) fuel
-- The existing sales_volume/sales_amount become the total
ALTER TABLE shift_fuel_summaries ADD COLUMN inside_volume REAL DEFAULT 0;
ALTER TABLE shift_fuel_summaries ADD COLUMN inside_amount REAL DEFAULT 0;
ALTER TABLE shift_fuel_summaries ADD COLUMN outside_volume REAL DEFAULT 0;
ALTER TABLE shift_fuel_summaries ADD COLUMN outside_amount REAL DEFAULT 0;

-- Add MSM-specific metadata columns
ALTER TABLE shift_fuel_summaries ADD COLUMN msm_period INTEGER;
ALTER TABLE shift_fuel_summaries ADD COLUMN msm_secondary_period INTEGER;
ALTER TABLE shift_fuel_summaries ADD COLUMN till_id TEXT;
ALTER TABLE shift_fuel_summaries ADD COLUMN register_id TEXT;

-- ============================================================================
-- STEP 2: Enhance day_fuel_summaries for MSM Period 1 daily totals
-- ============================================================================

-- Add MSM-specific inside/outside breakdown columns
ALTER TABLE day_fuel_summaries ADD COLUMN inside_volume REAL DEFAULT 0;
ALTER TABLE day_fuel_summaries ADD COLUMN inside_amount REAL DEFAULT 0;
ALTER TABLE day_fuel_summaries ADD COLUMN outside_volume REAL DEFAULT 0;
ALTER TABLE day_fuel_summaries ADD COLUMN outside_amount REAL DEFAULT 0;

-- Add discount tracking from MSM
ALTER TABLE day_fuel_summaries ADD COLUMN fuel_discount_amount REAL DEFAULT 0;

-- Add fuel_source tracking
ALTER TABLE day_fuel_summaries ADD COLUMN fuel_source TEXT DEFAULT 'FGM'
  CHECK(fuel_source IN ('FGM', 'MSM', 'CALCULATED', 'MANUAL'));

-- Add source file tracking for deduplication
ALTER TABLE day_fuel_summaries ADD COLUMN source_file_hash TEXT;

-- ============================================================================
-- STEP 3: Create msm_discount_summaries table for discount breakdown
-- ============================================================================

-- MSM files contain detailed discount information that doesn't fit in existing tables
CREATE TABLE IF NOT EXISTS msm_discount_summaries (
  msm_discount_id TEXT PRIMARY KEY,

  -- Store and date
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,

  -- Period information
  msm_period INTEGER NOT NULL,           -- 1=Daily, 98=Shift
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,

  -- Discount type
  discount_type TEXT NOT NULL CHECK(discount_type IN (
    'statistics_discounts',
    'discount_amount_fixed',
    'discount_amount_percentage',
    'discount_promotional',
    'discount_fuel',
    'discount_store_coupons'
  )),

  -- Values
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_count INTEGER DEFAULT 0,

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, business_date, msm_period, shift_id, discount_type)
);

CREATE INDEX IF NOT EXISTS idx_msm_discount_store_date ON msm_discount_summaries(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_msm_discount_shift ON msm_discount_summaries(shift_id);

-- ============================================================================
-- STEP 4: Create msm_outside_dispenser_records for Period 98 outside data
-- ============================================================================

-- Period 98 MSM files contain outside dispenser records after the closing tag
-- These provide shift-level outside fuel totals (but not by grade)
CREATE TABLE IF NOT EXISTS msm_outside_dispenser_records (
  outside_record_id TEXT PRIMARY KEY,

  -- Store and context
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,

  -- Register/Till identification
  register_id TEXT NOT NULL,
  till_id TEXT,
  cashier_id TEXT,

  -- Tender type (outsideCredit or outsideDebit)
  tender_type TEXT NOT NULL CHECK(tender_type IN ('outsideCredit', 'outsideDebit')),

  -- Values
  amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- Note: Volume by grade NOT available in Period 98 outside records

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, business_date, register_id, till_id, tender_type)
);

CREATE INDEX IF NOT EXISTS idx_msm_outside_store_date ON msm_outside_dispenser_records(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_msm_outside_shift ON msm_outside_dispenser_records(shift_id);
CREATE INDEX IF NOT EXISTS idx_msm_outside_register ON msm_outside_dispenser_records(register_id);

-- ============================================================================
-- STEP 5: Add performance indexes for MSM queries
-- ============================================================================

-- Index for finding fuel summaries by source
CREATE INDEX IF NOT EXISTS idx_shift_fuel_source ON shift_fuel_summaries(fuel_source);
CREATE INDEX IF NOT EXISTS idx_day_fuel_source ON day_fuel_summaries(fuel_source);

-- Composite index for MSM data lookups by shift
CREATE INDEX IF NOT EXISTS idx_shift_fuel_till ON shift_fuel_summaries(till_id) WHERE till_id IS NOT NULL;

-- ============================================================================
-- STEP 6: Add comment tracking for migration reference
-- ============================================================================

-- This migration supports the MSM Fuel Data Implementation Plan:
-- - Phase 2: Database Schema Updates
-- - Enables accurate fuel sales tracking matching PDF reports
-- - Supports both Period 1 (Daily) and Period 98 (Shift) MSM files
-- - Expected results: Inside $808.04/270.6 gal, Outside $664.44/241.308 gal
