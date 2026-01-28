import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Check all sync queue items for this pack
const items = db
  .prepare(
    `
  SELECT id, entity_id, operation, synced, sync_attempts, http_status, api_endpoint, created_at, synced_at, priority
  FROM sync_queue
  WHERE entity_id = '815452fe-aa11-48d3-bb4f-6968d63f4c7b'
  ORDER BY created_at ASC
`
  )
  .all() as any[];

console.log('=== SYNC QUEUE HISTORY FOR PACK ===');
console.log('Pack ID: 815452fe-aa11-48d3-bb4f-6968d63f4c7b');
console.log('Total queue items:', items.length);

for (const item of items) {
  console.log('');
  console.log('---');
  console.log('Queue ID:', item.id.substring(0, 8) + '...');
  console.log('Operation:', item.operation);
  console.log('Synced:', item.synced ? 'YES' : 'NO');
  console.log('Priority:', item.priority);
  console.log('Attempts:', item.sync_attempts);
  console.log('HTTP Status:', item.http_status || 'N/A');
  console.log('API Endpoint:', item.api_endpoint || 'N/A');
  console.log('Created:', item.created_at);
  console.log('Synced At:', item.synced_at || 'Not yet');
}

db.close();
