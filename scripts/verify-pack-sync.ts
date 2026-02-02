/**
 * Verify pack sync - check local pack ID and what was sent to cloud
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== LOCAL PACKS (RECEIVED STATUS) ===\n');
const receivedPacks = db
  .prepare(
    `
  SELECT pack_id, pack_number, game_id, status, received_at, serial_start, serial_end
  FROM lottery_packs
  WHERE status = 'RECEIVED'
  ORDER BY received_at DESC
`
  )
  .all();
console.log(JSON.stringify(receivedPacks, null, 2));

console.log('\n=== ALL LOCAL PACKS ===\n');
const allPacks = db
  .prepare(
    `
  SELECT pack_id, pack_number, status, received_at
  FROM lottery_packs
  ORDER BY received_at DESC
`
  )
  .all();
console.log(JSON.stringify(allPacks, null, 2));

console.log('\n=== RECENT SYNC LOG (pack entity) ===\n');
const syncLogs = db
  .prepare(
    `
  SELECT id, entity_type, entity_id, operation, status, synced_at, error_message
  FROM sync_log
  WHERE entity_type = 'pack'
  ORDER BY synced_at DESC
  LIMIT 10
`
  )
  .all();
console.log(JSON.stringify(syncLogs, null, 2));

console.log('\n=== RECENT SUCCESSFUL PACK SYNCS ===\n');
const successfulSyncs = db
  .prepare(
    `
  SELECT sq.id, sq.entity_type, sq.entity_id, sq.operation, sq.synced_at,
         lp.pack_number, lp.status as pack_status
  FROM sync_queue sq
  LEFT JOIN lottery_packs lp ON sq.entity_id = lp.pack_id
  WHERE sq.entity_type = 'pack' AND sq.synced = 1
  ORDER BY sq.synced_at DESC
  LIMIT 10
`
  )
  .all();
console.log(JSON.stringify(successfulSyncs, null, 2));

console.log('\n=== PACK IDs TO VERIFY IN CLOUD ===\n');
const packsToVerify = db
  .prepare(
    `
  SELECT pack_id, pack_number, status
  FROM lottery_packs
  ORDER BY received_at DESC
  LIMIT 5
`
  )
  .all();
for (const pack of packsToVerify as Array<{
  pack_id: string;
  pack_number: string;
  status: string;
}>) {
  console.log(`Pack Number: ${pack.pack_number}`);
  console.log(`  Local pack_id: ${pack.pack_id}`);
  console.log(`  Status: ${pack.status}`);
  console.log('');
}

db.close();
