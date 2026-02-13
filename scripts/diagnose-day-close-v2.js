/**
 * Comprehensive diagnostic for Day Close button visibility issue
 *
 * Tests BOTH conditions required for the button to show:
 * 1. isManualMode === true (from settings:getPOSConnectionType)
 * 2. dayStatusData?.hasOpenShifts === true (from terminals:getDayStatus)
 */
const Database = require('better-sqlite3');
const Store = require('electron-store');
const path = require('path');
const os = require('os');
const fs = require('fs');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     DAY CLOSE BUTTON DIAGNOSTIC - COMPREHENSIVE TEST       ║');
console.log('╚════════════════════════════════════════════════════════════╝');

// ============================================================================
// 1. TEST CONFIG STORE (simulates settingsService.getPOSConnectionType)
// ============================================================================
console.log('\n┌─────────────────────────────────────────────────────────────┐');
console.log('│ TEST 1: Electron Store (settings:getPOSConnectionType)     │');
console.log('└─────────────────────────────────────────────────────────────┘');

// Try different app names that might be used
const appNames = ['nuvana-sync', 'nuvana', 'Electron'];
let configStore = null;

for (const appName of appNames) {
  try {
    const testStore = new Store({ name: 'nuvana', cwd: path.join(os.homedir(), 'AppData', 'Roaming', appName) });
    const storeId = testStore.get('storeId');
    if (storeId) {
      configStore = testStore;
      console.log(`✓ Found config store with app name: "${appName}"`);
      break;
    }
  } catch (e) {
    // Try next
  }
}

if (!configStore) {
  console.log('✗ Could not find config store!');
  process.exit(1);
}

// Simulate getPOSConnectionType() exactly as the service does
const isConfigured = configStore.get('posConnection.isConfigured');
const newConnectionType = configStore.get('posConnection.connectionType');
const legacyConnectionType = configStore.get('terminal.connectionType');

console.log('\nSettings Service Simulation:');
console.log('  posConnection.isConfigured:', isConfigured);
console.log('  posConnection.connectionType:', newConnectionType);
console.log('  terminal.connectionType (legacy):', legacyConnectionType);

let connectionType;
if (isConfigured) {
  connectionType = newConnectionType || null;
  console.log('  → Using NEW format, connectionType:', connectionType);
} else {
  connectionType = legacyConnectionType;
  console.log('  → Using LEGACY format, connectionType:', connectionType);
}

const isManualMode = connectionType === 'MANUAL';
console.log('\n  ★ isManualMode:', isManualMode ? '✓ TRUE' : '✗ FALSE');

if (!isManualMode) {
  console.log('\n  ╔════════════════════════════════════════════════════════════╗');
  console.log('  ║ ISSUE FOUND: Store is NOT in MANUAL mode                   ║');
  console.log('  ║ The Day Close button only shows when connectionType=MANUAL ║');
  console.log('  ╚════════════════════════════════════════════════════════════╝');
}

// ============================================================================
// 2. TEST DATABASE (simulates terminals:getDayStatus)
// ============================================================================
console.log('\n┌─────────────────────────────────────────────────────────────┐');
console.log('│ TEST 2: Database Query (terminals:getDayStatus)            │');
console.log('└─────────────────────────────────────────────────────────────┘');

// Find database
const dbPaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana-sync', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'nuvana.db'),
];

let dbPath = null;
for (const p of dbPaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.log('✗ Database not found!');
  process.exit(1);
}

console.log(`✓ Found database: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

// Get store ID
const storeId = configStore.get('storeId');
console.log('  Store ID:', storeId);

// Get today's date (same logic as terminals.handlers.ts)
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
console.log('  Today (local):', today);

// Simulate getDayStatus query
const dayStatus = db.prepare(`
  SELECT
    COUNT(*) as total_shifts,
    SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as open_shifts
  FROM shifts
  WHERE store_id = ? AND business_date = ?
`).get(storeId, today);

const hasOpenShifts = (dayStatus?.open_shifts || 0) > 0;

console.log('\ngetDayStatus Query Result:');
console.log('  total_shifts:', dayStatus?.total_shifts || 0);
console.log('  open_shifts:', dayStatus?.open_shifts || 0);
console.log('\n  ★ hasOpenShifts:', hasOpenShifts ? '✓ TRUE' : '✗ FALSE');

if (!hasOpenShifts) {
  // Check if there are ANY open shifts (regardless of business_date)
  const allOpenShifts = db.prepare(`
    SELECT shift_id, business_date, start_time, external_register_id
    FROM shifts
    WHERE store_id = ? AND end_time IS NULL
    ORDER BY start_time DESC
  `).all(storeId);

  if (allOpenShifts.length > 0) {
    console.log('\n  ╔════════════════════════════════════════════════════════════╗');
    console.log('  ║ ISSUE FOUND: Open shifts exist but with WRONG business_date║');
    console.log('  ╚════════════════════════════════════════════════════════════╝');
    console.log('\n  Open shifts found:');
    allOpenShifts.forEach((s, i) => {
      const match = s.business_date === today ? '✓' : '✗ MISMATCH';
      console.log(`    ${i + 1}. business_date=${s.business_date} ${match} (started ${s.start_time})`);
    });
  } else {
    console.log('\n  ╔════════════════════════════════════════════════════════════╗');
    console.log('  ║ ISSUE FOUND: No open shifts in database                    ║');
    console.log('  ╚════════════════════════════════════════════════════════════╝');
  }
}

// ============================================================================
// 3. FINAL VERDICT
// ============================================================================
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                    FINAL VERDICT                           ║');
console.log('╚════════════════════════════════════════════════════════════╝');

const buttonShouldShow = isManualMode && hasOpenShifts;

console.log('\nButton visibility condition: isManualMode && hasOpenShifts');
console.log(`  isManualMode:    ${isManualMode ? '✓ TRUE' : '✗ FALSE'}`);
console.log(`  hasOpenShifts:   ${hasOpenShifts ? '✓ TRUE' : '✗ FALSE'}`);
console.log(`  ─────────────────────────────`);
console.log(`  Button shows:    ${buttonShouldShow ? '✓ YES' : '✗ NO'}`);

if (!buttonShouldShow) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  if (!isManualMode) {
    console.log('║ ROOT CAUSE: connectionType is not "MANUAL"                 ║');
    console.log('║ SOLUTION: Reconfigure store with MANUAL connection type    ║');
  } else if (!hasOpenShifts) {
    console.log('║ ROOT CAUSE: No open shifts with today\'s business_date      ║');
    console.log('║ SOLUTION: Start a new shift for today                      ║');
  }
  console.log('╚════════════════════════════════════════════════════════════╝');
}

db.close();
