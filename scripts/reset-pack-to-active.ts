/**
 * Reset a DEPLETED pack back to ACTIVE status for testing
 * Usage: npx tsx scripts/reset-pack-to-active.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

// Find the database path
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db');

console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Find depleted packs
const depletedPacks = db
  .prepare(
    `
  SELECT 
    lp.pack_id,
    lp.pack_number,
    lp.status,
    lp.opening_serial,
    lp.closing_serial,
    lp.tickets_sold_count,
    lp.sales_amount,
    lp.depleted_at,
    lg.name as game_name
  FROM lottery_packs lp
  LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
  WHERE lp.status = 'DEPLETED'
  ORDER BY lp.depleted_at DESC
  LIMIT 5
`
  )
  .all();

console.log('\nFound depleted packs:');
console.log(JSON.stringify(depletedPacks, null, 2));

if (depletedPacks.length === 0) {
  console.log('No depleted packs found to reset.');
  process.exit(0);
}

// Reset the most recently depleted pack
const packToReset = depletedPacks[0] as any;
console.log(`\nResetting pack: ${packToReset.pack_number} (${packToReset.pack_id})`);

const result = db
  .prepare(
    `
  UPDATE lottery_packs 
  SET 
    status = 'ACTIVE',
    closing_serial = NULL,
    tickets_sold_count = 0,
    sales_amount = 0,
    depleted_at = NULL,
    depleted_by = NULL,
    depleted_shift_id = NULL,
    depletion_reason = NULL,
    updated_at = datetime('now')
  WHERE pack_id = ?
`
  )
  .run(packToReset.pack_id);

console.log(`Updated ${result.changes} row(s)`);

// Verify the reset
const resetPack = db
  .prepare(
    `
  SELECT pack_id, pack_number, status, opening_serial, closing_serial, tickets_sold_count, sales_amount
  FROM lottery_packs
  WHERE pack_id = ?
`
  )
  .get(packToReset.pack_id);

console.log('\nPack after reset:');
console.log(JSON.stringify(resetPack, null, 2));

db.close();
console.log('\nDone! Pack has been reset to ACTIVE status.');
