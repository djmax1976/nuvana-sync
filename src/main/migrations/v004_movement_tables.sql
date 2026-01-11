-- v004_movement_tables.sql
-- Movement report tables from NAXML
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity
--
-- Movement reports track various POS metrics:
-- - FGM: Fuel Grade Movements
-- - FPM: Fuel Product Movements (pump meters)
-- - MSM: Miscellaneous Summaries
-- - MCM: Merchandise Category Movements
-- - TLM: Tax Level Movements
-- - ISM: Item Sales Movements

-- ============================================================================
-- Fuel Grade Movements (FGM)
-- ============================================================================

-- Fuel sales by grade (regular, plus, premium, diesel)
-- Parsed from NAXML FGM documents
-- DB-006: Scoped by store_id
CREATE TABLE fuel_grade_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  grade_id TEXT,
  grade_name TEXT,
  volume_sold REAL NOT NULL DEFAULT 0,
  amount_sold REAL NOT NULL DEFAULT 0,
  volume_unit TEXT NOT NULL DEFAULT 'GALLONS',
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  average_price_per_unit REAL,
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_fgm_store_date ON fuel_grade_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_fgm_shift ON fuel_grade_movements(shift_id);

-- Index for grade analysis
CREATE INDEX idx_fgm_grade ON fuel_grade_movements(store_id, grade_id);

-- ============================================================================
-- Fuel Product Movements (FPM)
-- ============================================================================

-- Non-resettable pump meter readings
-- Used for fuel inventory reconciliation
-- DB-006: Scoped by store_id
CREATE TABLE fuel_product_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  product_id TEXT,
  product_name TEXT,
  tank_id TEXT,
  pump_id TEXT,
  volume_sold REAL NOT NULL DEFAULT 0,
  amount_sold REAL NOT NULL DEFAULT 0,
  opening_meter REAL,
  closing_meter REAL,
  volume_unit TEXT NOT NULL DEFAULT 'GALLONS',
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_fpm_store_date ON fuel_product_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_fpm_shift ON fuel_product_movements(shift_id);

-- Index for pump/tank analysis
CREATE INDEX idx_fpm_pump ON fuel_product_movements(store_id, pump_id);

-- ============================================================================
-- Miscellaneous Summaries (MSM)
-- ============================================================================

-- Various non-sales movements (payouts, payins, safe drops, etc.)
-- Parsed from NAXML MSM documents
-- DB-006: Scoped by store_id
CREATE TABLE miscellaneous_summaries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  summary_type TEXT NOT NULL,
  summary_code TEXT,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  tender_type TEXT,
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_msm_store_date ON miscellaneous_summaries(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_msm_shift ON miscellaneous_summaries(shift_id);

-- Index for summary type analysis
CREATE INDEX idx_msm_type ON miscellaneous_summaries(store_id, summary_type);

-- ============================================================================
-- Merchandise Movements (MCM)
-- ============================================================================

-- Sales by merchandise department/category
-- Parsed from NAXML MCM documents
-- DB-006: Scoped by store_id
CREATE TABLE merchandise_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  department_id TEXT,
  department_name TEXT,
  category_id TEXT,
  category_name TEXT,
  quantity_sold REAL NOT NULL DEFAULT 0,
  amount_sold REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_mcm_store_date ON merchandise_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_mcm_shift ON merchandise_movements(shift_id);

-- Index for department analysis
CREATE INDEX idx_mcm_department ON merchandise_movements(store_id, department_id);

-- ============================================================================
-- Tax Level Movements (TLM)
-- ============================================================================

-- Tax collection by tax level/rate
-- Parsed from NAXML TLM documents
-- DB-006: Scoped by store_id
CREATE TABLE tax_level_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  tax_level TEXT NOT NULL,
  tax_level_name TEXT,
  tax_rate REAL,
  taxable_amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  exempt_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_tlm_store_date ON tax_level_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_tlm_shift ON tax_level_movements(shift_id);

-- Index for tax level analysis
CREATE INDEX idx_tlm_level ON tax_level_movements(store_id, tax_level);

-- ============================================================================
-- Item Sales Movements (ISM)
-- ============================================================================

-- Individual item sales detail
-- Parsed from NAXML ISM documents
-- Note: High volume table, consider partitioning for large datasets
-- DB-006: Scoped by store_id
CREATE TABLE item_sales_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  item_code TEXT NOT NULL,
  item_description TEXT,
  department_id TEXT,
  upc TEXT,
  quantity_sold REAL NOT NULL DEFAULT 0,
  amount_sold REAL NOT NULL DEFAULT 0,
  cost_amount REAL,
  discount_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_ism_store_date ON item_sales_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_ism_shift ON item_sales_movements(shift_id);

-- Index for item analysis
CREATE INDEX idx_ism_item ON item_sales_movements(store_id, item_code);

-- Index for UPC lookup
CREATE INDEX idx_ism_upc ON item_sales_movements(upc);

-- ============================================================================
-- Tender Product Movements (TPM)
-- ============================================================================

-- Payment/tender totals by type
-- Parsed from NAXML TPM documents
-- DB-006: Scoped by store_id
CREATE TABLE tender_product_movements (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id),
  tender_id TEXT,
  tender_name TEXT,
  tender_type TEXT,
  amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0 CHECK(refund_count >= 0),
  file_id TEXT REFERENCES processed_files(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for date range queries
CREATE INDEX idx_tpm_store_date ON tender_product_movements(store_id, business_date);

-- Index for shift analysis
CREATE INDEX idx_tpm_shift ON tender_product_movements(shift_id);

-- Index for tender analysis
CREATE INDEX idx_tpm_tender ON tender_product_movements(store_id, tender_id);

-- ============================================================================
-- Hourly Sales Summary
-- ============================================================================

-- Aggregated hourly sales data
-- Useful for traffic pattern analysis
-- DB-006: Scoped by store_id
CREATE TABLE hourly_sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK(hour >= 0 AND hour <= 23),
  transaction_count INTEGER NOT NULL DEFAULT 0 CHECK(transaction_count >= 0),
  total_amount REAL NOT NULL DEFAULT 0,
  fuel_amount REAL NOT NULL DEFAULT 0,
  merchandise_amount REAL NOT NULL DEFAULT 0,
  average_basket REAL,
  customer_count INTEGER NOT NULL DEFAULT 0 CHECK(customer_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one record per store per date per hour
  UNIQUE(store_id, business_date, hour)
);

-- Index for date range queries
CREATE INDEX idx_hourly_store_date ON hourly_sales(store_id, business_date);

-- Index for hour analysis
CREATE INDEX idx_hourly_hour ON hourly_sales(hour);
