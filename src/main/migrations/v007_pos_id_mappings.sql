-- v007_pos_id_mappings.sql
-- POS External ID to Internal UUID Mapping Tables
--
-- Purpose: Map external IDs from 3rd party POS systems (Gilbarco, Verifone, etc.)
-- to internal UUIDs. This allows the system to receive data with external IDs
-- and translate them to our internal identifiers consistently.
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity
--
-- Entity mappings:
-- - Store: External store location ID → Internal store UUID
-- - Cashier/Employee: External cashier ID → Internal user UUID
-- - Terminal/Register: External register ID → Internal terminal UUID (includes fuel dispensers)
-- - Fuel Position: External pump position ID → Internal dispenser UUID
-- - Till: External till ID → Internal till/shift UUID
-- - Fuel Grade: External grade ID → Internal fuel grade UUID
-- - Fuel Product: External product ID → Internal fuel product UUID
-- - Department: External merchandise code → Internal department UUID
-- - Tax Level: External tax level ID → Internal tax jurisdiction UUID

-- ============================================================================
-- Store ID Mapping
-- ============================================================================

-- Maps external POS store location IDs to internal store UUIDs
-- Note: Single-store app, but mapping supports future multi-store
-- DB-006: store_id references internal stores table
CREATE TABLE pos_store_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_store_id TEXT NOT NULL,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external store ID per POS system per store
  UNIQUE(store_id, external_store_id, pos_system_type)
);

-- Index for external ID lookup (primary use case)
CREATE INDEX idx_pos_store_map_external ON pos_store_mappings(external_store_id, pos_system_type);

-- ============================================================================
-- Cashier/Employee ID Mapping
-- ============================================================================

-- Maps external POS cashier IDs to internal user UUIDs
-- Gilbarco examples: "1" (default), "20000" (employee)
-- DB-006: Scoped by store_id
CREATE TABLE pos_cashier_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  internal_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  external_cashier_id TEXT NOT NULL,
  external_name TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  is_system_default INTEGER NOT NULL DEFAULT 0 CHECK(is_system_default IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external cashier ID per store
  UNIQUE(store_id, external_cashier_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_cashier_map_lookup ON pos_cashier_mappings(store_id, external_cashier_id);

-- Index for internal user lookup
CREATE INDEX idx_pos_cashier_map_user ON pos_cashier_mappings(internal_user_id);

-- ============================================================================
-- Terminal/Register ID Mapping
-- ============================================================================

-- Maps external POS register IDs to internal terminal UUIDs
-- Includes both store registers AND fuel dispensers (Gilbarco: "1" = store, "10002-10006" = pumps)
-- DB-006: Scoped by store_id
CREATE TABLE pos_terminal_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_register_id TEXT NOT NULL,
  terminal_type TEXT NOT NULL DEFAULT 'REGISTER' CHECK(terminal_type IN ('REGISTER', 'FUEL_DISPENSER', 'KIOSK', 'MOBILE')),
  description TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external register ID per store
  UNIQUE(store_id, external_register_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_terminal_map_lookup ON pos_terminal_mappings(store_id, external_register_id);

-- Index for type filtering
CREATE INDEX idx_pos_terminal_map_type ON pos_terminal_mappings(store_id, terminal_type);

-- ============================================================================
-- Fuel Position/Dispenser ID Mapping
-- ============================================================================

-- Maps external fuel position IDs to internal dispenser UUIDs
-- Gilbarco: FuelPositionID (1-7) = physical pump locations
-- Separate from terminal because pumps have BOTH RegisterID AND FuelPositionID
-- DB-006: Scoped by store_id
CREATE TABLE pos_fuel_position_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_position_id TEXT NOT NULL,
  related_terminal_mapping_id TEXT REFERENCES pos_terminal_mappings(id) ON DELETE SET NULL,
  pump_number INTEGER,
  description TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external position ID per store
  UNIQUE(store_id, external_position_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_fuel_pos_map_lookup ON pos_fuel_position_mappings(store_id, external_position_id);

-- ============================================================================
-- Till ID Mapping
-- ============================================================================

-- Maps external till IDs to internal shift/till tracking
-- Gilbarco: TillID patterns vary (4133, 0002, 10002, etc.)
-- DB-006: Scoped by store_id
CREATE TABLE pos_till_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(shift_id) ON DELETE SET NULL,
  external_till_id TEXT NOT NULL,
  business_date TEXT,
  related_terminal_mapping_id TEXT REFERENCES pos_terminal_mappings(id) ON DELETE SET NULL,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external till ID per store per business date
  UNIQUE(store_id, external_till_id, business_date, pos_system_type)
);

-- Index for external ID lookup by store and date (primary use case)
CREATE INDEX idx_pos_till_map_lookup ON pos_till_mappings(store_id, external_till_id, business_date);

-- Index for shift lookup
CREATE INDEX idx_pos_till_map_shift ON pos_till_mappings(shift_id);

-- ============================================================================
-- Fuel Grade ID Mapping
-- ============================================================================

-- Maps external fuel grade IDs to internal fuel grade identifiers
-- Gilbarco: "001"=Regular, "002"=Mid, "003"=Premium, "021"=Diesel, "300"=DEF
-- DB-006: Scoped by store_id
CREATE TABLE pos_fuel_grade_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_grade_id TEXT NOT NULL,
  internal_grade_name TEXT,
  fuel_type TEXT CHECK(fuel_type IN ('REGULAR', 'MIDGRADE', 'PREMIUM', 'DIESEL', 'E85', 'DEF', 'OTHER')),
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external grade ID per store
  UNIQUE(store_id, external_grade_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_fuel_grade_map_lookup ON pos_fuel_grade_mappings(store_id, external_grade_id);

-- ============================================================================
-- Fuel Product ID Mapping
-- ============================================================================

-- Maps external fuel product IDs to internal fuel product identifiers
-- Gilbarco: FuelProductID (1-4) = product categories
-- DB-006: Scoped by store_id
CREATE TABLE pos_fuel_product_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_product_id TEXT NOT NULL,
  internal_product_name TEXT,
  related_grade_mapping_id TEXT REFERENCES pos_fuel_grade_mappings(id) ON DELETE SET NULL,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external product ID per store
  UNIQUE(store_id, external_product_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_fuel_prod_map_lookup ON pos_fuel_product_mappings(store_id, external_product_id);

-- ============================================================================
-- Department/Merchandise Code Mapping
-- ============================================================================

-- Maps external merchandise codes to internal department IDs
-- Gilbarco: MerchandiseCode (0, 1024, etc.)
-- DB-006: Scoped by store_id
CREATE TABLE pos_department_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  department_id TEXT REFERENCES departments(department_id) ON DELETE SET NULL,
  external_merch_code TEXT NOT NULL,
  external_description TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external merchandise code per store
  UNIQUE(store_id, external_merch_code, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_dept_map_lookup ON pos_department_mappings(store_id, external_merch_code);

-- Index for department lookup
CREATE INDEX idx_pos_dept_map_dept ON pos_department_mappings(department_id);

-- ============================================================================
-- Tax Level ID Mapping
-- ============================================================================

-- Maps external tax level IDs to internal tax jurisdiction identifiers
-- Gilbarco: TaxLevelID ("99", etc.)
-- DB-006: Scoped by store_id
CREATE TABLE pos_tax_level_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_tax_level_id TEXT NOT NULL,
  internal_tax_name TEXT,
  tax_rate REAL,
  jurisdiction TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external tax level ID per store
  UNIQUE(store_id, external_tax_level_id, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_tax_map_lookup ON pos_tax_level_mappings(store_id, external_tax_level_id);

-- ============================================================================
-- Tender/Payment Method Mapping
-- ============================================================================

-- Maps external tender codes to internal payment method identifiers
-- Gilbarco: TenderCode ("cash", "outsideCredit", "outsideDebit", etc.)
-- DB-006: Scoped by store_id
CREATE TABLE pos_tender_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  tender_id TEXT REFERENCES tenders(tender_id) ON DELETE SET NULL,
  external_tender_code TEXT NOT NULL,
  external_tender_subcode TEXT,
  internal_tender_type TEXT CHECK(internal_tender_type IN ('CASH', 'CREDIT', 'DEBIT', 'EBT', 'CHECK', 'GIFT', 'FLEET', 'LOYALTY', 'OTHER')),
  description TEXT,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external tender code/subcode combo per store
  UNIQUE(store_id, external_tender_code, external_tender_subcode, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_tender_map_lookup ON pos_tender_mappings(store_id, external_tender_code);

-- Index for tender ID lookup
CREATE INDEX idx_pos_tender_map_tender ON pos_tender_mappings(tender_id);

-- ============================================================================
-- Price Tier Mapping
-- ============================================================================

-- Maps external price tier codes to internal pricing identifiers
-- Gilbarco: PriceTierCode ("0001"=cash, "0002"=credit, etc.)
-- DB-006: Scoped by store_id
CREATE TABLE pos_price_tier_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  external_tier_code TEXT NOT NULL,
  tier_name TEXT,
  tier_type TEXT CHECK(tier_type IN ('CASH', 'CREDIT', 'FLEET', 'LOYALTY', 'EMPLOYEE', 'OTHER')),
  price_differential REAL DEFAULT 0,
  pos_system_type TEXT NOT NULL DEFAULT 'gilbarco',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique: one mapping per external tier code per store
  UNIQUE(store_id, external_tier_code, pos_system_type)
);

-- Index for external ID lookup by store (primary use case)
CREATE INDEX idx_pos_tier_map_lookup ON pos_price_tier_mappings(store_id, external_tier_code);
