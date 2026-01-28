import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Get pending items with details
const pending = db
  .prepare(
    `
  SELECT id, entity_type, entity_id, operation, sync_attempts, max_attempts,
         last_sync_error, last_attempt_at, created_at, sync_direction,
         api_endpoint, http_status, payload
  FROM sync_queue
  WHERE synced = 0
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all() as any[];

console.log('=== PENDING SYNC ITEMS ===');
console.log('Total pending:', pending.length);
for (const item of pending) {
  const payload = JSON.parse(item.payload);
  console.log('');
  console.log('-----------------------------------');
  console.log('Pack Number:', payload.pack_number);
  console.log('Game Code:', payload.game_code);
  console.log('Status:', payload.status);
  console.log('Operation:', item.operation);
  console.log('Bin ID:', payload.bin_id ? payload.bin_id.substring(0, 8) + '...' : 'N/A');
  console.log('Created:', item.created_at);
  console.log('Attempts:', item.sync_attempts, '/', item.max_attempts);
  console.log('Last Error:', item.last_sync_error || 'None');
  console.log('Last Attempt:', item.last_attempt_at || 'Never');
  console.log('HTTP Status:', item.http_status || 'Not attempted yet');
}

// Check recent synced items
console.log('');
console.log('=== LAST 5 SYNCED ITEMS ===');
const synced = db
  .prepare(
    `
  SELECT entity_type, operation, synced_at, http_status, payload
  FROM sync_queue
  WHERE synced = 1
  ORDER BY synced_at DESC
  LIMIT 5
`
  )
  .all() as any[];

for (const item of synced) {
  const payload = JSON.parse(item.payload);
  console.log('');
  console.log(
    'Pack:',
    payload.pack_number || 'N/A',
    '| Game:',
    payload.game_code || 'N/A',
    '| Status:',
    payload.status || 'N/A'
  );
  console.log(
    'Operation:',
    item.operation,
    '| Synced:',
    item.synced_at,
    '| HTTP:',
    item.http_status || 'N/A'
  );
}

db.close();
