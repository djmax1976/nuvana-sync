/**
 * Script to re-queue a pack for sync
 * Usage: npx tsx scripts/requeue-pack.ts [pack_number]
 */

import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const packNumber = process.argv[2] || '0327710';
const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');

console.log('=============================================');
console.log('         RE-QUEUE PACK FOR SYNC             ');
console.log('=============================================\n');
console.log('Database:', dbPath);
console.log('Pack Number:', packNumber);
console.log('');

const db = new Database(dbPath);

// Find the pack
const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_number = ?').get(packNumber) as
  | Record<string, unknown>
  | undefined;

if (!pack) {
  console.log('Pack not found!');
  db.close();
  process.exit(1);
}

console.log('Found pack:');
console.log('  Pack ID:', pack.pack_id);
console.log('  Status:', pack.status);
console.log('  Store ID:', pack.store_id);
console.log('  Returned By:', pack.returned_by);
console.log('  Returned At:', pack.returned_at);
console.log('  Return Reason:', pack.return_reason);
console.log('');

// Build the payload based on status
const payload: Record<string, unknown> = {
  pack_id: pack.pack_id,
  store_id: pack.store_id,
  game_id: pack.game_id,
  game_code: pack.game_code,
  pack_number: pack.pack_number,
  status: pack.status,
  bin_id: pack.current_bin_id,
  opening_serial: pack.opening_serial,
  closing_serial: pack.closing_serial,
  tickets_sold: pack.tickets_sold_count,
  sales_amount: pack.sales_amount,
  received_at: pack.received_at,
  received_by: pack.received_by,
  activated_at: pack.activated_at,
  activated_by: pack.activated_by,
  depleted_at: pack.depleted_at,
  depleted_by: pack.depleted_by,
  depleted_shift_id: pack.depleted_shift_id,
  depletion_reason: pack.depletion_reason,
  returned_at: pack.returned_at,
  returned_by: pack.returned_by,
  returned_shift_id: pack.returned_shift_id,
  return_reason: pack.return_reason,
  return_notes: pack.return_notes,
};

// Create new queue item
const queueId = uuidv4();
const now = new Date().toISOString();

const insertStmt = db.prepare(`
  INSERT INTO sync_queue (
    id, store_id, entity_type, entity_id, operation, payload,
    priority, synced, sync_attempts, max_attempts, last_sync_error,
    last_attempt_at, created_at, synced_at, sync_direction,
    api_endpoint, http_status, response_body
  ) VALUES (
    ?, ?, 'pack', ?, 'UPDATE', ?,
    0, 0, 0, 5, NULL,
    NULL, ?, NULL, 'PUSH',
    NULL, NULL, NULL
  )
`);

insertStmt.run(queueId, pack.store_id, pack.pack_id, JSON.stringify(payload), now);

console.log('✅ Pack re-queued for sync!');
console.log('');
console.log('Queue Item ID:', queueId);
console.log('Operation: UPDATE');
console.log('Direction: PUSH');
console.log('');
console.log('Payload being sent:');
console.log(JSON.stringify(payload, null, 2));

db.close();
