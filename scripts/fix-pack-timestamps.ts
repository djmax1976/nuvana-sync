/**
 * Fix missing timestamps for active packs
 * Run with: npx ts-node scripts/fix-pack-timestamps.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

const now = new Date().toISOString();

// Update all ACTIVE packs that are missing received_at or activated_at
const result = db.prepare(`
  UPDATE lottery_packs
  SET
    received_at = COALESCE(received_at, ?),
    activated_at = COALESCE(activated_at, ?)
  WHERE status = 'ACTIVE'
    AND (received_at IS NULL OR activated_at IS NULL)
`).run(now, now);

console.log(`Updated ${result.changes} packs with missing timestamps`);

// Show the updated packs
const packs = db.prepare(`
  SELECT pack_id, pack_number, status, received_at, activated_at, created_at
  FROM lottery_packs
  WHERE status = 'ACTIVE'
`).all();

console.log('\nActive packs after update:');
console.log(JSON.stringify(packs, null, 2));

db.close();
console.log('\nDone.');
