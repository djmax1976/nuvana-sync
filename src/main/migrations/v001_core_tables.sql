-- v001_core_tables.sql
-- Core business tables with store_id for data provenance
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity

-- ============================================================================
-- Store Configuration
-- ============================================================================

-- Store configuration (single row, fetched from cloud)
-- DB-006: Store ID used for tenant isolation across all tables
CREATE TABLE stores (
  store_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- User Authentication
-- ============================================================================

-- Users (synced from cloud for local auth)
-- Security: SEC-001 - PIN stored as bcrypt hash (handled by DAL)
-- Security: DB-006 - Scoped by store_id for tenant isolation
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('CASHIER', 'MANAGER', 'ADMIN')),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  last_login_at TEXT,
  cloud_user_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient user lookup by store and active status
CREATE INDEX idx_users_store_active ON users(store_id, active);

-- Index for cloud user ID lookup during sync
CREATE INDEX idx_users_cloud_id ON users(cloud_user_id);

-- ============================================================================
-- Shift Management
-- ============================================================================

-- Shifts track POS operational periods
-- DB-006: Scoped by store_id
CREATE TABLE shifts (
  shift_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_number INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  cashier_id TEXT REFERENCES users(user_id),
  register_id TEXT,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient shift lookup by store and date
CREATE INDEX idx_shifts_store_date ON shifts(store_id, business_date);

-- Index for finding open shifts
CREATE INDEX idx_shifts_store_status ON shifts(store_id, status);

-- Unique constraint: one shift number per store per business date
CREATE UNIQUE INDEX idx_shifts_unique ON shifts(store_id, business_date, shift_number);

-- ============================================================================
-- Day Summaries
-- ============================================================================

-- Day summaries aggregate daily business metrics
-- DB-006: Scoped by store_id
CREATE TABLE day_summaries (
  summary_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  total_sales REAL NOT NULL DEFAULT 0 CHECK(total_sales >= 0),
  total_transactions INTEGER NOT NULL DEFAULT 0 CHECK(total_transactions >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSED')),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one summary per store per business date
  UNIQUE(store_id, business_date)
);

-- Index for date range queries
CREATE INDEX idx_day_summaries_date ON day_summaries(business_date);

-- ============================================================================
-- Transactions
-- ============================================================================

-- Transaction header records
-- DB-006: Scoped by store_id
CREATE TABLE transactions (
  transaction_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(shift_id),
  business_date TEXT NOT NULL,
  transaction_number INTEGER,
  transaction_time TEXT,
  register_id TEXT,
  cashier_id TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  payment_type TEXT,
  voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0, 1)),
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient transaction lookup by store and date
CREATE INDEX idx_transactions_store_date ON transactions(store_id, business_date);

-- Index for shift-based queries
CREATE INDEX idx_transactions_shift ON transactions(shift_id);

-- Index for transaction number lookup within store/date
CREATE INDEX idx_transactions_number ON transactions(store_id, business_date, transaction_number);

-- ============================================================================
-- Transaction Line Items
-- ============================================================================

-- Individual items within a transaction
-- DB-006: Scoped by store_id for direct queries
CREATE TABLE transaction_line_items (
  line_item_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK(line_number > 0),
  item_code TEXT,
  description TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total_price REAL NOT NULL DEFAULT 0,
  department_id TEXT,
  tax_amount REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  voided INTEGER NOT NULL DEFAULT 0 CHECK(voided IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for transaction lookup
CREATE INDEX idx_line_items_transaction ON transaction_line_items(transaction_id);

-- Index for item code analysis
CREATE INDEX idx_line_items_item_code ON transaction_line_items(store_id, item_code);

-- Index for department analysis
CREATE INDEX idx_line_items_department ON transaction_line_items(store_id, department_id);

-- ============================================================================
-- Transaction Payments
-- ============================================================================

-- Payment records for transactions (supports split payments)
-- DB-006: Scoped by store_id
CREATE TABLE transaction_payments (
  payment_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount != 0),
  tender_id TEXT,
  reference_number TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for transaction lookup
CREATE INDEX idx_payments_transaction ON transaction_payments(transaction_id);

-- Index for payment type analysis
CREATE INDEX idx_payments_type ON transaction_payments(store_id, payment_type);

-- ============================================================================
-- Departments
-- ============================================================================

-- Department definitions (synced from cloud)
-- DB-006: Scoped by store_id
CREATE TABLE departments (
  department_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  department_code TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  cloud_department_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, department_code)
);

-- Index for active departments
CREATE INDEX idx_departments_active ON departments(store_id, active);

-- ============================================================================
-- Tenders
-- ============================================================================

-- Tender/payment type definitions (synced from cloud)
-- DB-006: Scoped by store_id
CREATE TABLE tenders (
  tender_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  tender_code TEXT NOT NULL,
  name TEXT NOT NULL,
  tender_type TEXT NOT NULL CHECK(tender_type IN ('CASH', 'CREDIT', 'DEBIT', 'EBT', 'CHECK', 'GIFT', 'OTHER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  cloud_tender_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, tender_code)
);

-- Index for active tenders
CREATE INDEX idx_tenders_active ON tenders(store_id, active);
