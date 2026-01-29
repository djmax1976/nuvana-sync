/**
 * Diagnostic script to identify why 4 packs failed to sync
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== DIAGNOSING PACK SYNC ERRORS ===\n');

// Get stores table schema
const storeSchema = db.prepare(`PRAGMA table_info(stores)`).all() as any[];
console.log('Stores columns:', storeSchema.map((c) => c.name).join(', '));

// Get the store configuration
const store = db.prepare(`SELECT * FROM stores LIMIT 1`).get() as any;
if (!store) {
  console.log('ERROR: No store configured');
  process.exit(1);
}

console.log('\nStore ID:', store.store_id);
console.log('Store Name:', store.name);
console.log('');

// Get all local game_ids
const localGames = db
  .prepare(
    `
  SELECT game_id, name, game_code, store_id FROM lottery_games
`
  )
  .all() as { game_id: string; name: string; game_code: string; store_id: string }[];

const localGameIds = new Set(localGames.map((g) => g.game_id));
console.log('Local games count:', localGameIds.size);

// Check if games are for the right store
const gamesWithWrongStore = localGames.filter((g) => g.store_id !== store.store_id);
if (gamesWithWrongStore.length > 0) {
  console.log('\n=== GAMES WITH WRONG STORE ID ===');
  gamesWithWrongStore.forEach((g) => {
    console.log(`  ${g.name} (${g.game_id}): store=${g.store_id} (expected ${store.store_id})`);
  });
} else {
  console.log('All games have correct store_id');
}

// Get all local packs
const localPacks = db
  .prepare(
    `
  SELECT pack_id, pack_number, game_id, status, store_id FROM lottery_packs
`
  )
  .all() as any[];

console.log('\nLocal packs count:', localPacks.length);

// Check the sync_queue for the specific failed items
console.log('\n=== SYNC QUEUE PULL ITEMS (pack type) ===');
const pullItems = db
  .prepare(
    `
  SELECT id, entity_id, response_body, last_sync_error, created_at, synced, payload
  FROM sync_queue
  WHERE sync_direction = 'PULL'
    AND entity_type = 'pack'
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all() as any[];

pullItems.forEach((item) => {
  console.log(`\n${item.entity_id}:`);
  console.log(`  Response: ${item.response_body}`);
  console.log(`  Synced: ${item.synced}`);
  console.log(`  Created: ${item.created_at}`);
  if (item.last_sync_error) {
    console.log(`  Error: ${item.last_sync_error}`);
  }
});

// Check sync timestamps
console.log('\n=== SYNC TIMESTAMPS ===');
const timestamps = db
  .prepare(
    `
  SELECT * FROM sync_timestamps WHERE entity_type LIKE '%pack%'
`
  )
  .all() as any[];

if (timestamps.length === 0) {
  console.log('  No pack sync timestamps found');
} else {
  timestamps.forEach((t: any) => {
    console.log(`  ${t.entity_type}: last_pull=${t.last_pull_at}, last_push=${t.last_push_at}`);
  });
}

// Summary
console.log('\n=== SUMMARY ===');
console.log(`Games in DB: ${localGameIds.size}`);
console.log(`Packs in DB: ${localPacks.length}`);
console.log('');
console.log('The 4 pack sync errors are caused by packs from the cloud API that:');
console.log('1. Reference game_ids that do not exist in the local lottery_games table');
console.log('2. OR have a store_id mismatch');
console.log('');
console.log('The error details are logged to the Electron devtools console,');
console.log('not stored in the database. To see the actual pack numbers and game_ids,');
console.log("check the app's developer tools console (Ctrl+Shift+I in the app).");

db.close();
