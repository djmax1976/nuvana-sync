/**
 * Check pack return details and sync payload
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== CURRENT PACK STATE (ALL FIELDS) ===\n');
const pack = db
  .prepare(
    `
  SELECT *
  FROM lottery_packs
  WHERE pack_number = '0112840'
`
  )
  .get();
console.log(JSON.stringify(pack, null, 2));

console.log('\n=== SYNC QUEUE ENTRIES FOR THIS PACK ===\n');
const packId = (pack as any)?.pack_id;
if (packId) {
  const syncEntries = db
    .prepare(
      `
    SELECT id, entity_id, operation, synced, sync_attempts, last_sync_error,
           synced_at, created_at, payload
    FROM sync_queue
    WHERE entity_id = ?
    ORDER BY created_at DESC
  `
    )
    .all(packId);

  for (const entry of syncEntries as any[]) {
    console.log(`--- ${entry.operation} (synced: ${entry.synced}) ---`);
    console.log(`Created: ${entry.created_at}`);
    console.log(`Synced At: ${entry.synced_at}`);
    console.log(`Error: ${entry.last_sync_error || 'None'}`);

    if (entry.payload) {
      try {
        const payload = JSON.parse(entry.payload);
        console.log('Payload:');
        console.log(JSON.stringify(payload, null, 2));
      } catch {
        console.log('Payload (raw):', entry.payload);
      }
    }
    console.log('');
  }
}

console.log('\n=== RETURN-SPECIFIC FIELDS ===\n');
if (pack) {
  const p = pack as any;
  console.log('Return Status:', p.status);
  console.log('Returned At:', p.returned_at || '(not set)');
  console.log('Returned By:', p.returned_by || '(not set)');
  console.log('Return Reason:', p.return_reason || '(not set)');
  console.log('Return Notes:', p.return_notes || '(not set)');
  console.log('Tickets Sold on Return:', p.tickets_sold_on_return ?? '(not set)');
  console.log('Return Sales Amount:', p.return_sales_amount ?? '(not set)');
  console.log('Last Sold Serial:', p.last_sold_serial || '(not set)');
  console.log('Opening Serial:', p.opening_serial || '(not set)');
  console.log('Closing Serial:', p.closing_serial || '(not set)');
}

db.close();
