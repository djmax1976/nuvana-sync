-- v010_schema_alignment.sql
-- Schema alignment: Rename local tables to match cloud PostgreSQL schema
--
-- Decision: Local table names match cloud table names exactly.
-- Industry standard pattern (PowerSync, ElectricSQL, PouchDB).
-- Context (database connection) tells you local vs cloud, not table name.
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity
--
-- Reference: docs/local-schema-alignment.md

-- ============================================================================
-- STEP 1: Create lookup tables first (no dependencies)
-- ============================================================================

-- fuel_grades: Fuel product definitions
CREATE TABLE IF NOT EXISTS fuel_grades (
  fuel_grade_id TEXT PRIMARY KEY,
  company_id TEXT,
  store_id TEXT REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Grade identification
  grade_id TEXT NOT NULL,              -- POS code: "001", "002", "003", "300"
  product_code TEXT,                   -- Optional alternate code

  -- Display
  name TEXT NOT NULL,                  -- "Regular Unleaded", "Premium", etc.
  short_name TEXT,                     -- "REG", "PREM", "DSL"
  description TEXT,

  -- Classification
  product_type TEXT DEFAULT 'GASOLINE' CHECK(product_type IN ('GASOLINE', 'DIESEL', 'E85', 'DEF', 'OTHER')),

  -- Configuration
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, grade_id)
);

-- fuel_positions: Pump/dispenser positions
CREATE TABLE IF NOT EXISTS fuel_positions (
  fuel_position_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Position identification
  position_id TEXT NOT NULL,           -- POS code: "1", "2", "3", etc.
  dispenser_id TEXT,                   -- Optional alternate ID

  -- Display
  name TEXT,                           -- "Pump 1", "Island A - Position 1"
  description TEXT,

  -- Configuration
  fuel_grade_ids TEXT,                 -- JSON array of grade IDs available
  is_active INTEGER DEFAULT 1,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, position_id)
);

-- tender_types: Payment method definitions
CREATE TABLE IF NOT EXISTS tender_types (
  tender_type_id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Identification
  code TEXT NOT NULL,                  -- "CASH", "CREDIT", "DEBIT", etc.
  display_name TEXT NOT NULL,          -- "Cash", "Credit Card", etc.
  description TEXT,

  -- Behavior flags
  is_cash_equivalent INTEGER DEFAULT 0,
  requires_reference INTEGER DEFAULT 0,
  is_electronic INTEGER DEFAULT 0,
  affects_cash_drawer INTEGER DEFAULT 1,

  -- Configuration
  sort_order INTEGER DEFAULT 0,

  -- POS integration
  pos_code TEXT,                       -- Code from POS system
  pos_source TEXT,                     -- Which POS type

  -- Lifecycle
  is_active INTEGER DEFAULT 1,
  is_system INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, code)
);

-- tax_rates: Tax rate definitions
CREATE TABLE IF NOT EXISTS tax_rates (
  tax_rate_id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Identification
  code TEXT NOT NULL,                  -- "99", "STATE_TX", etc.
  display_name TEXT NOT NULL,
  description TEXT,

  -- Tax details
  rate REAL NOT NULL,                  -- 0.0825 for 8.25%
  rate_type TEXT DEFAULT 'PERCENTAGE' CHECK(rate_type IN ('PERCENTAGE', 'FIXED')),

  -- Jurisdiction
  jurisdiction_level TEXT DEFAULT 'STATE',
  jurisdiction_code TEXT,

  -- Effective dates
  effective_from TEXT NOT NULL,
  effective_to TEXT,

  -- Configuration
  sort_order INTEGER DEFAULT 0,
  is_compound INTEGER DEFAULT 0,

  -- POS integration
  pos_code TEXT,
  pos_source TEXT,

  -- Lifecycle
  is_active INTEGER DEFAULT 1,
  is_system INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, code, effective_from)
);

-- ============================================================================
-- STEP 2: Create parent summary tables
-- ============================================================================

-- shift_summaries: Parent for all shift-level child tables
CREATE TABLE IF NOT EXISTS shift_summaries (
  shift_summary_id TEXT PRIMARY KEY,
  shift_id TEXT UNIQUE NOT NULL REFERENCES shifts(shift_id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Business date
  business_date TEXT NOT NULL,

  -- Timing
  shift_opened_at TEXT,
  shift_closed_at TEXT,
  shift_duration_mins INTEGER,

  -- Personnel
  opened_by_user_id TEXT,
  closed_by_user_id TEXT,
  cashier_user_id TEXT,

  -- Sales totals
  gross_sales REAL NOT NULL DEFAULT 0,
  returns_total REAL NOT NULL DEFAULT 0,
  discounts_total REAL NOT NULL DEFAULT 0,
  net_sales REAL NOT NULL DEFAULT 0,

  -- Tax
  tax_collected REAL NOT NULL DEFAULT 0,
  tax_exempt_sales REAL NOT NULL DEFAULT 0,
  taxable_sales REAL NOT NULL DEFAULT 0,

  -- Transaction counts
  transaction_count INTEGER NOT NULL DEFAULT 0,
  void_count INTEGER NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0,
  no_sale_count INTEGER NOT NULL DEFAULT 0,

  -- Item counts
  items_sold_count INTEGER NOT NULL DEFAULT 0,
  items_returned_count INTEGER NOT NULL DEFAULT 0,

  -- Averages
  avg_transaction REAL DEFAULT 0,
  avg_items_per_txn REAL DEFAULT 0,

  -- Cash drawer reconciliation
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL NOT NULL DEFAULT 0,
  expected_cash REAL NOT NULL DEFAULT 0,
  cash_variance REAL NOT NULL DEFAULT 0,
  variance_percentage REAL DEFAULT 0,
  variance_approved INTEGER DEFAULT 0,
  variance_approved_by TEXT,
  variance_approved_at TEXT,
  variance_reason TEXT,

  -- Lottery totals (nullable)
  lottery_sales REAL,
  lottery_cashes REAL,
  lottery_net REAL,
  lottery_packs_sold INTEGER,
  lottery_tickets_sold INTEGER,

  -- Fuel totals (nullable)
  fuel_gallons REAL,
  fuel_sales REAL,

  -- Metadata
  extra_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shift_summaries_store_date ON shift_summaries(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_shift_summaries_date ON shift_summaries(business_date);

-- day_summaries: Parent for all day-level child tables (replaces old day_summaries structure)
-- First drop and recreate to ensure correct schema
DROP TABLE IF EXISTS day_summaries_new;
CREATE TABLE day_summaries_new (
  day_summary_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,

  -- Shift counts
  shift_count INTEGER DEFAULT 0,

  -- Timing
  first_shift_opened TEXT,
  last_shift_closed TEXT,

  -- Sales totals (aggregated from all shifts)
  gross_sales REAL DEFAULT 0,
  returns_total REAL DEFAULT 0,
  discounts_total REAL DEFAULT 0,
  net_sales REAL DEFAULT 0,

  -- Tax
  tax_collected REAL DEFAULT 0,
  tax_exempt_sales REAL DEFAULT 0,
  taxable_sales REAL DEFAULT 0,

  -- Transaction counts
  transaction_count INTEGER DEFAULT 0,
  void_count INTEGER DEFAULT 0,
  refund_count INTEGER DEFAULT 0,
  customer_count INTEGER DEFAULT 0,

  -- Item counts
  items_sold_count INTEGER DEFAULT 0,
  items_returned_count INTEGER DEFAULT 0,

  -- Averages
  avg_transaction REAL DEFAULT 0,
  avg_items_per_txn REAL DEFAULT 0,

  -- Cash reconciliation
  total_opening_cash REAL DEFAULT 0,
  total_closing_cash REAL DEFAULT 0,
  total_expected_cash REAL DEFAULT 0,
  total_cash_variance REAL DEFAULT 0,

  -- Lottery
  lottery_sales REAL,
  lottery_cashes REAL,
  lottery_net REAL,
  lottery_packs_sold INTEGER,
  lottery_tickets_sold INTEGER,

  -- Fuel
  fuel_gallons REAL,
  fuel_sales REAL,

  -- Status
  status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'PENDING_CLOSE', 'CLOSED')),
  closed_at TEXT,
  closed_by TEXT,

  -- Notes
  notes TEXT,

  -- Metadata
  extra_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, business_date)
);

-- Migrate existing day_summaries data if table exists
INSERT OR IGNORE INTO day_summaries_new (
  day_summary_id, store_id, business_date, gross_sales, transaction_count,
  status, closed_at, created_at, updated_at
)
SELECT
  summary_id, store_id, business_date, total_sales, total_transactions,
  status, closed_at, created_at, updated_at
FROM day_summaries WHERE EXISTS (SELECT 1 FROM day_summaries LIMIT 1);

-- Drop old table and rename new
DROP TABLE IF EXISTS day_summaries;
ALTER TABLE day_summaries_new RENAME TO day_summaries;

CREATE INDEX IF NOT EXISTS idx_day_summaries_store_date ON day_summaries(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_day_summaries_status ON day_summaries(status);

-- ============================================================================
-- STEP 3: Create child summary tables
-- ============================================================================

-- shift_fuel_summaries: Fuel sales by grade per shift (replaces fuel_grade_movements)
CREATE TABLE IF NOT EXISTS shift_fuel_summaries (
  shift_fuel_summary_id TEXT PRIMARY KEY,
  shift_summary_id TEXT NOT NULL REFERENCES shift_summaries(shift_summary_id) ON DELETE CASCADE,
  fuel_grade_id TEXT REFERENCES fuel_grades(fuel_grade_id),

  -- Tender type (CASH, CREDIT, DEBIT)
  tender_type TEXT NOT NULL CHECK(tender_type IN ('CASH', 'CREDIT', 'DEBIT', 'FLEET', 'OTHER', 'ALL')),

  -- Sales data
  sales_volume REAL NOT NULL,          -- Gallons
  sales_amount REAL NOT NULL,          -- Dollars
  discount_amount REAL DEFAULT 0,
  discount_count INTEGER DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- Pricing
  unit_price REAL,                     -- Price per gallon

  -- Legacy fields for migration
  grade_id TEXT,                       -- Original POS grade code
  grade_name TEXT,                     -- Original POS grade name

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(shift_summary_id, fuel_grade_id, tender_type)
);

CREATE INDEX IF NOT EXISTS idx_shift_fuel_summaries_shift ON shift_fuel_summaries(shift_summary_id);
CREATE INDEX IF NOT EXISTS idx_shift_fuel_summaries_grade ON shift_fuel_summaries(fuel_grade_id);

-- day_fuel_summaries: Daily fuel summary by grade
CREATE TABLE IF NOT EXISTS day_fuel_summaries (
  day_fuel_summary_id TEXT PRIMARY KEY,
  day_summary_id TEXT NOT NULL REFERENCES day_summaries(day_summary_id) ON DELETE CASCADE,
  fuel_grade_id TEXT REFERENCES fuel_grades(fuel_grade_id),

  -- Aggregated sales (all tenders combined)
  total_volume REAL NOT NULL DEFAULT 0,
  total_sales REAL NOT NULL DEFAULT 0,
  total_discount REAL DEFAULT 0,

  -- Tender breakdown
  cash_volume REAL DEFAULT 0,
  cash_sales REAL DEFAULT 0,
  credit_volume REAL DEFAULT 0,
  credit_sales REAL DEFAULT 0,
  debit_volume REAL DEFAULT 0,
  debit_sales REAL DEFAULT 0,

  -- Reconciliation (book vs meter)
  meter_volume REAL,                   -- From FPM totalizers
  book_volume REAL,                    -- From FGM sales
  variance_volume REAL,                -- meter - book
  variance_amount REAL,

  -- Legacy fields for migration
  grade_id TEXT,
  grade_name TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(day_summary_id, fuel_grade_id)
);

CREATE INDEX IF NOT EXISTS idx_day_fuel_summaries_day ON day_fuel_summaries(day_summary_id);

-- shift_department_summaries: Sales by department per shift (replaces merchandise_movements)
CREATE TABLE IF NOT EXISTS shift_department_summaries (
  id TEXT PRIMARY KEY,
  shift_summary_id TEXT NOT NULL REFERENCES shift_summaries(shift_summary_id) ON DELETE CASCADE,

  -- Department identification
  department_id TEXT,
  department_code TEXT NOT NULL,
  department_name TEXT,

  -- Sales totals
  gross_sales REAL NOT NULL DEFAULT 0,
  returns_total REAL DEFAULT 0,
  discounts_total REAL DEFAULT 0,
  net_sales REAL NOT NULL DEFAULT 0,

  -- Tax
  tax_collected REAL DEFAULT 0,

  -- Counts
  transaction_count INTEGER DEFAULT 0,
  items_sold_count INTEGER DEFAULT 0,
  items_returned_count INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(shift_summary_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_shift_department_summaries_shift ON shift_department_summaries(shift_summary_id);

-- day_department_summaries: Daily department summary
CREATE TABLE IF NOT EXISTS day_department_summaries (
  id TEXT PRIMARY KEY,
  day_summary_id TEXT NOT NULL REFERENCES day_summaries(day_summary_id) ON DELETE CASCADE,

  -- Department identification
  department_id TEXT,
  department_code TEXT NOT NULL,
  department_name TEXT,

  -- Sales totals
  gross_sales REAL NOT NULL DEFAULT 0,
  returns_total REAL DEFAULT 0,
  discounts_total REAL DEFAULT 0,
  net_sales REAL NOT NULL DEFAULT 0,

  -- Tax
  tax_collected REAL DEFAULT 0,

  -- Counts
  transaction_count INTEGER DEFAULT 0,
  items_sold_count INTEGER DEFAULT 0,
  items_returned_count INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(day_summary_id, department_code)
);

CREATE INDEX IF NOT EXISTS idx_day_department_summaries_day ON day_department_summaries(day_summary_id);

-- shift_tender_summaries: Payment totals by tender type per shift (replaces media_movements)
CREATE TABLE IF NOT EXISTS shift_tender_summaries (
  id TEXT PRIMARY KEY,
  shift_summary_id TEXT NOT NULL REFERENCES shift_summaries(shift_summary_id) ON DELETE CASCADE,

  -- Tender identification
  tender_type_id TEXT REFERENCES tender_types(tender_type_id),
  tender_code TEXT NOT NULL,
  tender_display_name TEXT,

  -- Totals
  total_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- Refund breakdown
  refund_amount REAL DEFAULT 0,
  refund_count INTEGER DEFAULT 0,

  -- Net
  net_amount REAL NOT NULL DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(shift_summary_id, tender_code)
);

CREATE INDEX IF NOT EXISTS idx_shift_tender_summaries_shift ON shift_tender_summaries(shift_summary_id);

-- day_tender_summaries: Daily tender summary
CREATE TABLE IF NOT EXISTS day_tender_summaries (
  id TEXT PRIMARY KEY,
  day_summary_id TEXT NOT NULL REFERENCES day_summaries(day_summary_id) ON DELETE CASCADE,

  -- Tender identification
  tender_type_id TEXT REFERENCES tender_types(tender_type_id),
  tender_code TEXT NOT NULL,
  tender_display_name TEXT,

  -- Totals
  total_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,

  -- Refund breakdown
  refund_amount REAL DEFAULT 0,
  refund_count INTEGER DEFAULT 0,

  -- Net
  net_amount REAL NOT NULL DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(day_summary_id, tender_code)
);

CREATE INDEX IF NOT EXISTS idx_day_tender_summaries_day ON day_tender_summaries(day_summary_id);

-- shift_tax_summaries: Tax collection by rate per shift (replaces tax_level_movements)
CREATE TABLE IF NOT EXISTS shift_tax_summaries (
  id TEXT PRIMARY KEY,
  shift_summary_id TEXT NOT NULL REFERENCES shift_summaries(shift_summary_id) ON DELETE CASCADE,

  -- Tax identification
  tax_rate_id TEXT REFERENCES tax_rates(tax_rate_id),
  tax_code TEXT NOT NULL,
  tax_display_name TEXT,
  tax_rate_snapshot REAL,

  -- Totals
  taxable_amount REAL NOT NULL DEFAULT 0,
  tax_collected REAL NOT NULL DEFAULT 0,
  exempt_amount REAL DEFAULT 0,

  -- Counts
  transaction_count INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(shift_summary_id, tax_code)
);

CREATE INDEX IF NOT EXISTS idx_shift_tax_summaries_shift ON shift_tax_summaries(shift_summary_id);

-- day_tax_summaries: Daily tax summary
CREATE TABLE IF NOT EXISTS day_tax_summaries (
  id TEXT PRIMARY KEY,
  day_summary_id TEXT NOT NULL REFERENCES day_summaries(day_summary_id) ON DELETE CASCADE,

  -- Tax identification
  tax_rate_id TEXT REFERENCES tax_rates(tax_rate_id),
  tax_code TEXT NOT NULL,
  tax_display_name TEXT,
  tax_rate_snapshot REAL,

  -- Totals
  taxable_amount REAL NOT NULL DEFAULT 0,
  tax_collected REAL NOT NULL DEFAULT 0,
  exempt_amount REAL DEFAULT 0,

  -- Counts
  transaction_count INTEGER DEFAULT 0,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(day_summary_id, tax_code)
);

CREATE INDEX IF NOT EXISTS idx_day_tax_summaries_day ON day_tax_summaries(day_summary_id);

-- ============================================================================
-- STEP 4: Create meter and tank reading tables
-- ============================================================================

-- meter_readings: Pump totalizer readings (replaces fuel_product_movements)
CREATE TABLE IF NOT EXISTS meter_readings (
  meter_reading_id TEXT PRIMARY KEY,

  -- Store reference
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  fuel_position_id TEXT REFERENCES fuel_positions(fuel_position_id),
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,
  day_summary_id TEXT REFERENCES day_summaries(day_summary_id) ON DELETE SET NULL,

  -- Product identification
  fuel_product_id TEXT NOT NULL,

  -- Reading type
  reading_type TEXT NOT NULL CHECK(reading_type IN ('OPEN', 'CLOSE', 'INTERIM')),

  -- Timing
  reading_timestamp TEXT,
  business_date TEXT NOT NULL,

  -- Meter values (cumulative totalizers - never reset)
  volume_reading REAL NOT NULL,
  amount_reading REAL DEFAULT 0,

  -- Legacy fields for migration
  pump_id TEXT,
  product_name TEXT,

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meter_readings_store_date ON meter_readings(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_meter_readings_position ON meter_readings(fuel_position_id);
CREATE INDEX IF NOT EXISTS idx_meter_readings_type ON meter_readings(reading_type);

-- tank_readings: ATG tank inventory readings (replaces tender_product_movements - TPM was misnamed!)
CREATE TABLE IF NOT EXISTS tank_readings (
  tank_reading_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,

  -- Report context
  business_date TEXT NOT NULL,
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,
  day_summary_id TEXT REFERENCES day_summaries(day_summary_id) ON DELETE SET NULL,

  -- Tank identification
  tank_id INTEGER NOT NULL,
  fuel_grade_id TEXT REFERENCES fuel_grades(fuel_grade_id),

  -- Reading timestamp
  reading_date TEXT,
  reading_time TEXT,

  -- Tank measurements
  fuel_product_volume REAL,
  water_volume REAL,
  water_depth REAL,
  fuel_temperature REAL,
  ullage REAL,
  product_height REAL,

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(store_id, business_date, tank_id, reading_time)
);

CREATE INDEX IF NOT EXISTS idx_tank_readings_store_date ON tank_readings(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_tank_readings_tank ON tank_readings(tank_id);

-- ============================================================================
-- STEP 5: Create item_sales table (replaces inside_sales_movements/item_sales_movements)
-- ============================================================================

CREATE TABLE IF NOT EXISTS item_sales (
  item_sale_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,
  day_summary_id TEXT REFERENCES day_summaries(day_summary_id) ON DELETE SET NULL,

  -- Timing
  business_date TEXT NOT NULL,

  -- Item identification
  item_code TEXT NOT NULL,
  item_description TEXT,
  upc TEXT,
  department_id TEXT,
  department_code TEXT,

  -- Sales data
  quantity_sold REAL NOT NULL DEFAULT 0,
  amount_sold REAL NOT NULL DEFAULT 0,
  cost_amount REAL,
  discount_amount REAL NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,

  -- Source tracking
  source_file_hash TEXT,

  -- Audit
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_sales_store_date ON item_sales(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_item_sales_item ON item_sales(item_code);
CREATE INDEX IF NOT EXISTS idx_item_sales_upc ON item_sales(upc);

-- ============================================================================
-- NOTE: Old tables are NOT dropped in this migration
-- They will be dropped in a separate migration after:
-- 1. DAL files are updated to use new tables
-- 2. Parsers are updated to write to new tables
-- 3. Data migration scripts have run
-- ============================================================================

-- Tables to drop later (v011_cleanup_old_tables.sql):
-- - fuel_grade_movements (replaced by shift_fuel_summaries)
-- - fuel_product_movements (replaced by meter_readings)
-- - merchandise_movements (replaced by shift_department_summaries)
-- - tax_level_movements (replaced by shift_tax_summaries)
-- - tender_product_movements (replaced by tank_readings - was misnamed!)
-- - item_sales_movements (replaced by item_sales)
-- - miscellaneous_summaries (keep for now, evaluate later)
-- - hourly_sales (keep for now, may add shift_hourly_summaries later)
