/**
 * Debug script to check pack serial data in database
 * Run with: node scripts/debug-pack-serial.js <pack_number>
 * Example: node scripts/debug-pack-serial.js 0070151
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Find the database file - check multiple locations (most likely first)
const possiblePaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana-sync', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'nuvana.db'),
];

const fs = require('fs');
let dbPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('Database not found in any of:', possiblePaths);
  process.exit(1);
}

console.log('Database path:', dbPath);

const db = new Database(dbPath, { readonly: true });

const packNumber = process.argv[2];
if (!packNumber) {
  console.error('Usage: node scripts/debug-pack-serial.js <pack_number>');
  process.exit(1);
}

console.log('\n=== Pack Details ===');
const pack = db.prepare(`
  SELECT pack_id, pack_number, store_id, status, opening_serial, closing_serial, game_id
  FROM lottery_packs
  WHERE pack_number = ?
`).get(packNumber);

if (!pack) {
  console.log('Pack not found with pack_number:', packNumber);
  process.exit(1);
}

console.log(pack);

console.log('\n=== lottery_day_packs for this pack ===');
const dayPacks = db.prepare(`
  SELECT
    ldp.day_pack_id,
    ldp.pack_id,
    ldp.day_id,
    ldp.starting_serial,
    ldp.ending_serial,
    ldp.tickets_sold,
    lbd.business_date,
    lbd.status as day_status,
    lbd.opened_at,
    lbd.closed_at
  FROM lottery_day_packs ldp
  JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
  WHERE ldp.pack_id = ?
  ORDER BY lbd.business_date DESC
`).all(pack.pack_id);

console.log('Found', dayPacks.length, 'day_pack records:');
dayPacks.forEach((dp, i) => {
  console.log(`\n[${i + 1}]`, {
    business_date: dp.business_date,
    day_status: dp.day_status,
    starting_serial: dp.starting_serial,
    ending_serial: dp.ending_serial,
    tickets_sold: dp.tickets_sold,
    closed_at: dp.closed_at,
  });
});

console.log('\n=== Subquery result (what getPackDetails sees) ===');
const prevEnding = db.prepare(`
  SELECT ldp.ending_serial
  FROM lottery_day_packs ldp
  JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
  WHERE ldp.pack_id = ?
    AND lbd.status = 'CLOSED'
  ORDER BY lbd.closed_at DESC
  LIMIT 1
`).get(pack.pack_id);

console.log('prev_ending_serial from subquery:', prevEnding?.ending_serial ?? 'NULL');

if (prevEnding?.ending_serial) {
  const start = 0;
  const end = 59; // Assuming 60-ticket pack
  const current = parseInt(prevEnding.ending_serial, 10);
  const remaining = (end + 1) - current;
  console.log(`\nExpected calculation: (${end} + 1) - ${current} = ${remaining} tickets remaining`);
} else {
  console.log('\nNo CLOSED day found - will fall back to opening_serial');
}

db.close();
