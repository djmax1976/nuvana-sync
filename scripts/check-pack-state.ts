/**
 * Check current pack state and sync activity
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== CURRENT PACK STATE ===\n');
const packs = db
  .prepare(
    `
  SELECT pack_id, pack_number, status, received_at, activated_at, current_bin_id
  FROM lottery_packs
  ORDER BY updated_at DESC
`
  )
  .all();
console.log(JSON.stringify(packs, null, 2));

console.log('\n=== RECENT SYNC QUEUE ACTIVITY (pack entity) ===\n');
const syncActivity = db
  .prepare(
    `
  SELECT id, entity_id, operation, synced, sync_attempts, last_sync_error, synced_at, created_at
  FROM sync_queue
  WHERE entity_type = 'pack'
  ORDER BY created_at DESC
  LIMIT 15
`
  )
  .all();
console.log(JSON.stringify(syncActivity, null, 2));

console.log('\n=== PACK ID VERIFICATION ===\n');
const pack = packs[0] as { pack_id: string; pack_number: string; status: string } | undefined;
if (pack) {
  console.log('Most recently updated pack:');
  console.log(`  Pack Number: ${pack.pack_number}`);
  console.log(`  Pack ID: ${pack.pack_id}`);
  console.log(`  Status: ${pack.status}`);

  // Check if this pack_id appears consistently in sync queue
  const syncEntries = db
    .prepare(
      `
    SELECT operation, synced, sync_attempts, created_at
    FROM sync_queue
    WHERE entity_id = ?
    ORDER BY created_at ASC
  `
    )
    .all(pack.pack_id);

  console.log(`\n  Sync history for this pack_id (${syncEntries.length} entries):`);
  for (const entry of syncEntries as Array<{
    operation: string;
    synced: number;
    sync_attempts: number;
    created_at: string;
  }>) {
    console.log(
      `    - ${entry.operation}: synced=${entry.synced}, attempts=${entry.sync_attempts}, created=${entry.created_at}`
    );
  }
}

db.close();
