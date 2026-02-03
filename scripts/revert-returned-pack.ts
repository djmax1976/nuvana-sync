/**
 * Revert RETURNED pack to ACTIVE and clear sync queue
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath);

console.log('=== CURRENT PACKS ===\n');
const packs = db.prepare(`SELECT pack_id, pack_number, status FROM lottery_packs`).all();
console.log(JSON.stringify(packs, null, 2));

// Find RETURNED pack
const returnedPack = db
  .prepare(
    `
  SELECT pack_id, pack_number FROM lottery_packs WHERE status = 'RETURNED'
`
  )
  .get() as { pack_id: string; pack_number: string } | undefined;

if (returnedPack) {
  console.log(`\nReverting pack ${returnedPack.pack_number} to ACTIVE...`);

  db.prepare(
    `
    UPDATE lottery_packs
    SET status = 'ACTIVE',
        returned_at = NULL,
        returned_by = NULL,
        returned_shift_id = NULL,
        return_reason = NULL,
        return_notes = NULL,
        returned_day_id = NULL,
        tickets_sold_on_return = NULL,
        return_sales_amount = NULL,
        updated_at = datetime('now')
    WHERE pack_id = ?
  `
  ).run(returnedPack.pack_id);

  console.log('Pack reverted to ACTIVE');

  // Clear pending sync items for this pack
  const deleted = db
    .prepare(
      `
    DELETE FROM sync_queue WHERE entity_id = ? AND synced = 0
  `
    )
    .run(returnedPack.pack_id);
  console.log(`Deleted ${deleted.changes} pending sync queue items`);

  // Clear any DLQ items for this pack
  const dlqDeleted = db
    .prepare(
      `
    DELETE FROM sync_queue WHERE entity_id = ? AND dead_lettered = 1
  `
    )
    .run(returnedPack.pack_id);
  console.log(`Deleted ${dlqDeleted.changes} DLQ items`);
} else {
  console.log('\nNo RETURNED pack found');
}

console.log('\n=== AFTER REVERT ===\n');
const after = db.prepare(`SELECT pack_id, pack_number, status FROM lottery_packs`).all();
console.log(JSON.stringify(after, null, 2));

db.close();
