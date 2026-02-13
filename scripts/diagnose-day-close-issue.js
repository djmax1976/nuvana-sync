/**
 * Diagnostic script for day close issue
 * Checks database state for lottery days, shifts, and sync queue
 */
const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');

// Actual production database path
const dbPath = path.join(process.env.APPDATA, 'nuvana', 'nuvana.db');

if (!fs.existsSync(dbPath)) {
  console.error('Database not found at:', dbPath);
  process.exit(1);
}

console.log('Database:', dbPath);
console.log('='.repeat(80));

// Open database (not encrypted in dev mode)
const db = new Database(dbPath, { readonly: true });

// First, check the schema
console.log('\n=== DATABASE SCHEMA ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// Get lottery_business_days columns
console.log('\n=== lottery_business_days COLUMNS ===');
const lbdCols = db.prepare("PRAGMA table_info(lottery_business_days)").all();
console.table(lbdCols.map(c => ({ name: c.name, type: c.type })));

// Get stores
console.log('\n=== STORES ===');
const stores = db.prepare('SELECT store_id, name FROM stores').all();
console.table(stores);

// Use Store 2
const storeId = stores.find(s => s.name.includes('2'))?.store_id || stores[0]?.store_id;
console.log('\n>>> Analyzing store_id:', storeId);

// Check lottery_business_days
console.log('\n' + '='.repeat(80));
console.log('=== ALL LOTTERY BUSINESS DAYS ===');
const allDays = db.prepare(`
  SELECT day_id, business_date, status,
         datetime(opened_at/1000, 'unixepoch', 'localtime') as opened_at_local,
         datetime(closed_at/1000, 'unixepoch', 'localtime') as closed_at_local,
         total_packs_sold, total_sales_amount, opened_by, closed_by
  FROM lottery_business_days
  WHERE store_id = ?
  ORDER BY opened_at DESC
`).all(storeId);
console.table(allDays);

// Check OPEN lottery days
console.log('\n=== OPEN LOTTERY DAYS ===');
const openDays = db.prepare(`
  SELECT day_id, business_date, status,
         datetime(opened_at/1000, 'unixepoch', 'localtime') as opened_at_local
  FROM lottery_business_days
  WHERE store_id = ? AND status = 'OPEN'
`).all(storeId);
if (openDays.length === 0) {
  console.log('NO OPEN LOTTERY DAYS FOUND!');
} else {
  console.table(openDays);
}

// Check CLOSED lottery days
console.log('\n=== CLOSED LOTTERY DAYS (for reports) ===');
const closedDays = db.prepare(`
  SELECT day_id, business_date, status,
         datetime(opened_at/1000, 'unixepoch', 'localtime') as opened_at_local,
         datetime(closed_at/1000, 'unixepoch', 'localtime') as closed_at_local,
         total_packs_sold, total_sales_amount
  FROM lottery_business_days
  WHERE store_id = ? AND status = 'CLOSED'
  ORDER BY closed_at DESC
`).all(storeId);
if (closedDays.length === 0) {
  console.log('NO CLOSED LOTTERY DAYS FOUND - THIS IS THE PROBLEM!');
} else {
  console.table(closedDays);
}

// Get shifts columns
console.log('\n=== shifts COLUMNS ===');
const shiftCols = db.prepare("PRAGMA table_info(shifts)").all();
console.table(shiftCols.map(c => ({ name: c.name, type: c.type })));

// Check shifts
console.log('\n' + '='.repeat(80));
console.log('=== ALL SHIFTS ===');
const shifts = db.prepare(`
  SELECT s.shift_id, s.status,
         datetime(s.started_at/1000, 'unixepoch', 'localtime') as started_local,
         datetime(s.ended_at/1000, 'unixepoch', 'localtime') as ended_local,
         ss.closing_cash,
         s.terminal_id, s.cashier_id
  FROM shifts s
  LEFT JOIN shift_summaries ss ON s.shift_id = ss.shift_id
  WHERE s.store_id = ?
  ORDER BY s.started_at DESC
`).all(storeId);
console.table(shifts);

// Check OPEN shifts
console.log('\n=== OPEN SHIFTS ===');
const openShifts = db.prepare(`
  SELECT shift_id, status,
         datetime(started_at/1000, 'unixepoch', 'localtime') as started_local,
         terminal_id, cashier_id
  FROM shifts
  WHERE store_id = ? AND status = 'OPEN'
`).all(storeId);
if (openShifts.length === 0) {
  console.log('No open shifts');
} else {
  console.table(openShifts);
}

// Check sync queue columns
console.log('\n=== sync_queue COLUMNS ===');
const sqCols = db.prepare("PRAGMA table_info(sync_queue)").all();
console.table(sqCols.map(c => ({ name: c.name, type: c.type })));

// Check sync queue for recent entries
console.log('\n' + '='.repeat(80));
console.log('=== SYNC QUEUE (Last 30 entries) ===');
const syncQueue = db.prepare(`
  SELECT queue_id, entity_type, entity_id, action, status,
         datetime(created_at/1000, 'unixepoch', 'localtime') as created_local,
         datetime(synced_at/1000, 'unixepoch', 'localtime') as synced_local,
         error_message
  FROM sync_queue
  WHERE store_id = ?
  ORDER BY created_at DESC
  LIMIT 30
`).all(storeId);
if (syncQueue.length === 0) {
  console.log('No sync queue entries');
} else {
  console.table(syncQueue);
}

// Summary diagnosis
console.log('\n' + '='.repeat(80));
console.log('=== DIAGNOSIS SUMMARY ===');
console.log(`Total lottery days for store: ${allDays.length}`);
console.log(`Open lottery days: ${openDays.length}`);
console.log(`Closed lottery days: ${closedDays.length}`);
console.log(`Total shifts for store: ${shifts.length}`);
console.log(`Open shifts: ${openShifts.length}`);

if (closedDays.length === 0 && allDays.length > 0) {
  console.log('\n>>> ISSUE DETECTED: Lottery days exist but none are CLOSED');
  console.log('>>> The commitDayClose handler likely failed or was not called');
}

if (openDays.length > 1) {
  console.log('\n>>> ISSUE DETECTED: Multiple OPEN lottery days');
  console.log('>>> This violates BIZ-007 - should only have one open day');
}

db.close();
console.log('\nDiagnosis complete.');
