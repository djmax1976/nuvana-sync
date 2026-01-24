-- v003_lottery_tables.sql
-- Lottery management tables
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity
-- Note: Soft deletes (deleted_at) used for games/bins to preserve history

-- ============================================================================
-- Lottery Games
-- ============================================================================

-- Lottery game definitions (bi-directional sync with cloud)
-- Supports soft delete for historical integrity
-- DB-006: Scoped by store_id
CREATE TABLE lottery_games (
  game_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  game_code TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL CHECK(price > 0),
  pack_value REAL NOT NULL DEFAULT 300 CHECK(pack_value > 0),
  tickets_per_pack INTEGER CHECK(tickets_per_pack > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  deleted_at TEXT,
  cloud_game_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one game code per store (active games only)
  UNIQUE(store_id, game_code)
);

-- Index for active games lookup
CREATE INDEX idx_lottery_games_active ON lottery_games(store_id, status, deleted_at);

-- Index for game code search
CREATE INDEX idx_lottery_games_code ON lottery_games(game_code);

-- ============================================================================
-- Lottery Bins
-- ============================================================================

-- Lottery bin/slot definitions (bi-directional sync with cloud)
-- Bins are physical locations where packs are displayed
-- DB-006: Scoped by store_id
CREATE TABLE lottery_bins (
  bin_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  bin_number INTEGER NOT NULL CHECK(bin_number > 0),
  label TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  deleted_at TEXT,
  cloud_bin_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one bin number per store
  UNIQUE(store_id, bin_number)
);

-- Index for active bins
CREATE INDEX idx_lottery_bins_active ON lottery_bins(store_id, status, deleted_at);

-- ============================================================================
-- Lottery Packs
-- ============================================================================

-- Lottery pack inventory and status tracking
-- Lifecycle: RECEIVED -> ACTIVATED -> SETTLED or RETURNED
-- DB-006: Scoped by store_id
CREATE TABLE lottery_packs (
  pack_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES lottery_games(game_id),
  pack_number TEXT NOT NULL,
  bin_id TEXT REFERENCES lottery_bins(bin_id),
  status TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK(status IN ('RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED')),
  received_at TEXT,
  activated_at TEXT,
  settled_at TEXT,
  returned_at TEXT,
  opening_serial TEXT,
  closing_serial TEXT,
  tickets_sold INTEGER NOT NULL DEFAULT 0 CHECK(tickets_sold >= 0),
  sales_amount REAL NOT NULL DEFAULT 0 CHECK(sales_amount >= 0),
  cloud_pack_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one pack number per game per store
  UNIQUE(store_id, game_id, pack_number)
);

-- Index for pack status queries
CREATE INDEX idx_packs_store_status ON lottery_packs(store_id, status);

-- Index for bin inventory
CREATE INDEX idx_packs_bin ON lottery_packs(bin_id);

-- Index for game-specific pack queries
CREATE INDEX idx_packs_game ON lottery_packs(game_id, status);

-- Index for pack number search
CREATE INDEX idx_packs_number ON lottery_packs(pack_number);

-- ============================================================================
-- Lottery Business Days
-- ============================================================================

-- Lottery business day tracking
-- Aggregates daily lottery activity
-- DB-006: Scoped by store_id
CREATE TABLE lottery_business_days (
  day_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'PENDING_CLOSE', 'CLOSED')),
  opened_at TEXT,
  closed_at TEXT,
  opened_by TEXT REFERENCES users(user_id),
  closed_by TEXT REFERENCES users(user_id),
  total_sales REAL NOT NULL DEFAULT 0 CHECK(total_sales >= 0),
  total_packs_sold INTEGER NOT NULL DEFAULT 0 CHECK(total_packs_sold >= 0),
  total_packs_activated INTEGER NOT NULL DEFAULT 0 CHECK(total_packs_activated >= 0),
  cloud_day_id TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one business day record per store per date
  UNIQUE(store_id, business_date)
);

-- Index for date range queries
CREATE INDEX idx_lottery_days_date ON lottery_business_days(business_date);

-- Index for open days
CREATE INDEX idx_lottery_days_status ON lottery_business_days(store_id, status);

-- ============================================================================
-- Lottery Shift Openings
-- ============================================================================

-- Record of pack serial numbers at shift start
-- Used for variance calculation
-- DB-006: Scoped by store_id
CREATE TABLE lottery_shift_openings (
  opening_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL REFERENCES shifts(shift_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),
  serial_number TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for shift lookup
CREATE INDEX idx_lottery_openings_shift ON lottery_shift_openings(shift_id);

-- Index for pack history
CREATE INDEX idx_lottery_openings_pack ON lottery_shift_openings(pack_id);

-- ============================================================================
-- Lottery Shift Closings
-- ============================================================================

-- Record of pack serial numbers at shift end
-- Used for variance calculation
-- DB-006: Scoped by store_id
CREATE TABLE lottery_shift_closings (
  closing_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL REFERENCES shifts(shift_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),
  serial_number TEXT NOT NULL,
  tickets_sold INTEGER CHECK(tickets_sold >= 0),
  sales_amount REAL CHECK(sales_amount >= 0),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for shift lookup
CREATE INDEX idx_lottery_closings_shift ON lottery_shift_closings(shift_id);

-- Index for pack history
CREATE INDEX idx_lottery_closings_pack ON lottery_shift_closings(pack_id);

-- ============================================================================
-- Lottery Day Packs
-- ============================================================================

-- Daily pack activity summary
-- Links packs to business days with opening/closing serials
-- DB-006: Scoped by store_id
CREATE TABLE lottery_day_packs (
  day_pack_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES lottery_business_days(day_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),
  bin_id TEXT REFERENCES lottery_bins(bin_id),
  starting_serial TEXT NOT NULL,
  ending_serial TEXT,
  tickets_sold INTEGER CHECK(tickets_sold >= 0),
  sales_amount REAL CHECK(sales_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one record per day per pack
  UNIQUE(day_id, pack_id)
);

-- Index for day summary
CREATE INDEX idx_day_packs_day ON lottery_day_packs(day_id);

-- Index for pack history
CREATE INDEX idx_day_packs_pack ON lottery_day_packs(pack_id);

-- ============================================================================
-- Lottery Variances
-- ============================================================================

-- Track discrepancies between expected and actual counts
-- DB-006: Scoped by store_id
CREATE TABLE lottery_variances (
  variance_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES lottery_business_days(day_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),
  expected_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  variance INTEGER NOT NULL,
  variance_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'REVIEWED', 'RESOLVED')),
  notes TEXT,
  reviewed_by TEXT REFERENCES users(user_id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for day lookup
CREATE INDEX idx_variances_day ON lottery_variances(day_id);

-- Index for pack history
CREATE INDEX idx_variances_pack ON lottery_variances(pack_id);

-- Index for pending variances
CREATE INDEX idx_variances_status ON lottery_variances(store_id, status);

-- ============================================================================
-- Lottery Activations
-- ============================================================================

-- Track individual pack activation events
-- DB-006: Scoped by store_id
CREATE TABLE lottery_activations (
  activation_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),
  shift_id TEXT REFERENCES shifts(shift_id),
  day_id TEXT REFERENCES lottery_business_days(day_id),
  bin_id TEXT REFERENCES lottery_bins(bin_id),
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_by TEXT REFERENCES users(user_id),
  opening_serial TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for shift lookup
CREATE INDEX idx_activations_shift ON lottery_activations(shift_id);

-- Index for day lookup
CREATE INDEX idx_activations_day ON lottery_activations(day_id);

-- Index for pack history
CREATE INDEX idx_activations_pack ON lottery_activations(pack_id);
