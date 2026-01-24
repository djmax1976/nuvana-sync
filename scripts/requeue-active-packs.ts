/**
 * Re-queue Active Packs for Sync
 *
 * This script finds all lottery packs with ACTIVE status and creates new
 * sync queue entries with the complete payload required by the API spec.
 *
 * API spec requires: pack_id, bin_id, opening_serial, game_code, pack_number,
 *                    serial_start, serial_end, mark_sold_reason
 *
 * Run with: npx ts-node scripts/requeue-active-packs.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath);

// First, let's see what active packs exist
console.log('\n=== FINDING ACTIVE PACKS ===');

interface ActivePack {
  pack_id: string;
  store_id: string;
  game_id: string;
  pack_number: string;
  status: string;
  bin_id: string | null;
  opening_serial: string | null;
  closing_serial: string | null;
  tickets_sold: number;
  sales_amount: number;
  received_at: string | null;
  received_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  depleted_at: string | null;
  returned_at: string | null;
  cloud_pack_id: string | null;
  game_code: string;
  game_name: string;
  tickets_per_pack: number | null;
}

const activePacks = db
  .prepare(
    `SELECT
      p.pack_id,
      p.store_id,
      p.game_id,
      p.pack_number,
      p.status,
      p.bin_id,
      p.opening_serial,
      p.closing_serial,
      p.tickets_sold,
      p.sales_amount,
      p.received_at,
      p.received_by,
      p.activated_at,
      p.activated_by,
      p.depleted_at,
      p.returned_at,
      p.cloud_pack_id,
      g.game_code,
      g.name as game_name,
      g.tickets_per_pack
     FROM lottery_packs p
     JOIN lottery_games g ON p.game_id = g.game_id
     WHERE p.status = 'ACTIVE'
     ORDER BY p.activated_at DESC`
  )
  .all() as ActivePack[];

console.log(`Found ${activePacks.length} active packs`);

if (activePacks.length === 0) {
  console.log('No active packs to re-queue.');
  db.close();
  process.exit(0);
}

// Show the packs
console.log('\n=== ACTIVE PACKS DETAILS ===');
for (const pack of activePacks) {
  console.log(`  Pack: ${pack.pack_number} (${pack.game_code} - ${pack.game_name})`);
  console.log(`    - pack_id: ${pack.pack_id}`);
  console.log(`    - cloud_pack_id: ${pack.cloud_pack_id || 'NOT SYNCED'}`);
  console.log(`    - bin_id: ${pack.bin_id}`);
  console.log(`    - opening_serial: ${pack.opening_serial}`);
  console.log(`    - tickets_per_pack: ${pack.tickets_per_pack}`);
  console.log(`    - activated_at: ${pack.activated_at}`);
  console.log('');
}

// Check for existing unsynced queue items for these packs
console.log('\n=== CHECKING EXISTING QUEUE ITEMS ===');
const existingQueueItems = db
  .prepare(
    `SELECT entity_id, COUNT(*) as count
     FROM sync_queue
     WHERE entity_type = 'pack'
       AND synced = 0
       AND entity_id IN (${activePacks.map(() => '?').join(',')})
     GROUP BY entity_id`
  )
  .all(...activePacks.map((p) => p.pack_id)) as Array<{ entity_id: string; count: number }>;

if (existingQueueItems.length > 0) {
  console.log('Found existing unsynced queue items:');
  for (const item of existingQueueItems) {
    console.log(`  - ${item.entity_id}: ${item.count} pending items`);
  }
}

// Create new sync queue entries
console.log('\n=== CREATING NEW SYNC QUEUE ENTRIES ===');

const insertStmt = db.prepare(`
  INSERT INTO sync_queue (
    id, store_id, entity_type, entity_id, operation, payload,
    synced, sync_attempts, created_at, updated_at
  ) VALUES (?, ?, 'pack', ?, 'UPDATE', ?, 0, 0, ?, ?)
`);

const now = new Date().toISOString();
let created = 0;

for (const pack of activePacks) {
  // Skip if pack doesn't have a cloud_pack_id yet (needs to be created first)
  if (!pack.cloud_pack_id) {
    console.log(`  SKIPPING ${pack.pack_number}: No cloud_pack_id (pack not synced to cloud yet)`);
    continue;
  }

  // Calculate serial_start and serial_end
  const serialStart = '000';
  const serialEnd = pack.tickets_per_pack
    ? String(pack.tickets_per_pack - 1).padStart(3, '0')
    : '299'; // Default to 299 (300 tickets)

  // Build the complete payload required by API spec
  const payload = {
    pack_id: pack.pack_id,
    store_id: pack.store_id,
    game_id: pack.game_id,
    game_code: pack.game_code,
    pack_number: pack.pack_number,
    status: pack.status,
    bin_id: pack.bin_id,
    opening_serial: pack.opening_serial,
    closing_serial: pack.closing_serial,
    tickets_sold: pack.tickets_sold,
    sales_amount: pack.sales_amount,
    received_at: pack.received_at,
    received_by: pack.received_by,
    activated_at: pack.activated_at,
    activated_by: pack.activated_by,
    depleted_at: pack.depleted_at,
    returned_at: pack.returned_at,
    // NEW: Serial range fields required by activate API
    serial_start: serialStart,
    serial_end: serialEnd,
    // Shift tracking fields (set to null if not available)
    shift_id: null,
    depleted_shift_id: null,
    depleted_by: null,
    returned_shift_id: null,
    returned_by: null,
    depletion_reason: null,
  };

  const id = uuidv4();
  insertStmt.run(id, pack.store_id, pack.pack_id, JSON.stringify(payload), now, now);

  console.log(`  QUEUED: ${pack.pack_number} (${pack.game_code})`);
  console.log(`    - serial_start: ${serialStart}, serial_end: ${serialEnd}`);
  created++;
}

console.log(`\n=== SUMMARY ===`);
console.log(`Active packs found: ${activePacks.length}`);
console.log(`New queue entries created: ${created}`);
console.log(`Skipped (no cloud_pack_id): ${activePacks.length - created}`);

// Verify the new queue entries
console.log('\n=== VERIFYING NEW QUEUE ENTRIES ===');
const newItems = db
  .prepare(
    `SELECT
      id,
      entity_id,
      json_extract(payload, '$.pack_number') as pack_number,
      json_extract(payload, '$.game_code') as game_code,
      json_extract(payload, '$.serial_start') as serial_start,
      json_extract(payload, '$.serial_end') as serial_end,
      json_extract(payload, '$.bin_id') as bin_id,
      json_extract(payload, '$.opening_serial') as opening_serial,
      synced,
      created_at
     FROM sync_queue
     WHERE entity_type = 'pack'
       AND synced = 0
       AND created_at = ?
     ORDER BY created_at DESC`
  )
  .all(now);

console.log('Newly created queue entries:');
console.log(JSON.stringify(newItems, null, 2));

db.close();
console.log('\nDatabase closed.');
console.log('\nTo sync these packs, the app will pick them up on the next sync cycle.');
console.log('Or you can trigger a manual sync from the app.');
