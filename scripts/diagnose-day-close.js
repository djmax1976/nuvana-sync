/**
 * Diagnostic script to find why Day Close button is not showing
 */
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Find the database - check multiple possible locations
const possiblePaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana-sync', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'nuvana.db'),
];

let dbPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

console.log('Checked paths:', possiblePaths);
console.log('Found database at:', dbPath);

if (!dbPath) {
  console.log('Database not found in any location!');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// Get today's date in local format
const now = new Date();
const todayLocal = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
console.log('\n=== TODAY\'S DATE (Local) ===');
console.log('Today:', todayLocal);

// Check POS connection config from config file
console.log('\n=== POS CONNECTION CONFIG ===');
const configPaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana-sync', 'nuvana.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'nuvana.json'),
];

let configPath = null;
for (const p of configPaths) {
  if (fs.existsSync(p)) {
    configPath = p;
    break;
  }
}

if (configPath) {
  console.log('Config file:', configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // The config uses nested object structure (not flat keys)
  console.log('posConnection.posType:', config.posConnection?.posType || 'NOT SET');
  console.log('posConnection.connectionType:', config.posConnection?.connectionType || 'NOT SET');
  console.log('posConnection.isConfigured:', config.posConnection?.isConfigured || false);

  const isManual = config.posConnection?.connectionType === 'MANUAL';
  console.log('isManualMode:', isManual);

  if (!isManual) {
    console.log('\n*** ISSUE #1: Store is NOT in MANUAL mode ***');
    console.log('    The Day Close button only shows when connectionType === "MANUAL"');
  }
} else {
  console.log('Config file not found in any location!');
}

// Get configured store
console.log('\n=== CONFIGURED STORE ===');
const store = db.prepare('SELECT store_id, name FROM stores LIMIT 1').get();
if (store) {
  console.log('Store ID:', store.store_id);
  console.log('Store Name:', store.name);
} else {
  console.log('No configured store found!');
  process.exit(1);
}

// Get ALL open shifts (end_time IS NULL)
console.log('\n=== ALL OPEN SHIFTS (end_time IS NULL) ===');
const openShifts = db.prepare(`
  SELECT shift_id, business_date, shift_number, start_time, status, end_time, external_register_id
  FROM shifts
  WHERE store_id = ? AND end_time IS NULL
  ORDER BY start_time DESC
`).all(store.store_id);

if (openShifts.length === 0) {
  console.log('No open shifts found!');
} else {
  openShifts.forEach((s, i) => {
    console.log(`\nShift #${i + 1}:`);
    console.log('  shift_id:', s.shift_id);
    console.log('  business_date:', s.business_date, s.business_date === todayLocal ? '✓ MATCHES TODAY' : '✗ DOES NOT MATCH TODAY');
    console.log('  shift_number:', s.shift_number);
    console.log('  start_time:', s.start_time);
    console.log('  status:', s.status);
    console.log('  end_time:', s.end_time);
    console.log('  external_register_id:', s.external_register_id);
  });
}

// Count open shifts for TODAY's business_date
console.log('\n=== getDayStatus SIMULATION ===');
const dayStatusResult = db.prepare(`
  SELECT
    COUNT(*) as total_shifts,
    SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as open_shifts
  FROM shifts
  WHERE store_id = ? AND business_date = ?
`).get(store.store_id, todayLocal);

console.log('Query: WHERE business_date =', todayLocal);
console.log('total_shifts:', dayStatusResult.total_shifts);
console.log('open_shifts:', dayStatusResult.open_shifts);
console.log('hasOpenShifts:', dayStatusResult.open_shifts > 0 ? 'TRUE -> Day Close button SHOULD show' : 'FALSE -> Day Close button WILL NOT show');

// Show the mismatch clearly
if (openShifts.length > 0 && dayStatusResult.open_shifts === 0) {
  console.log('\n=== BUG DETECTED ===');
  console.log('There ARE open shifts, but getDayStatus returns hasOpenShifts=false');
  console.log('Reason: The open shifts have a DIFFERENT business_date than today');
  console.log('Open shift business_dates:', [...new Set(openShifts.map(s => s.business_date))].join(', '));
  console.log('Today\'s date:', todayLocal);
}

db.close();
