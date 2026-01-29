import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Query the specific queue item
const item = db
  .prepare(
    `
  SELECT
    id, entity_type, entity_id, operation, sync_direction,
    api_endpoint, http_status, response_body,
    last_sync_error, sync_attempts, max_attempts,
    created_at, last_attempt_at, synced_at, synced,
    payload
  FROM sync_queue
  WHERE id = '6f9066de-d2bb-46a3-9989-e56bca46f563'
`
  )
  .get() as any;

if (item) {
  console.log('=== SYNC QUEUE ITEM ===');
  console.log('ID:', item.id);
  console.log('Entity Type:', item.entity_type);
  console.log('Entity ID:', item.entity_id);
  console.log('Operation:', item.operation);
  console.log('Direction:', item.sync_direction);
  console.log('Synced:', item.synced);
  console.log('');
  console.log('API Endpoint:', item.api_endpoint);
  console.log('HTTP Status:', item.http_status);
  console.log('Response Body:', item.response_body);
  console.log('');
  console.log('Last Sync Error:', item.last_sync_error || 'None');
  console.log('Sync Attempts:', item.sync_attempts);
  console.log('Max Attempts:', item.max_attempts);
  console.log('');
  console.log('Created:', item.created_at);
  console.log('Last Attempt:', item.last_attempt_at);
  console.log('Synced At:', item.synced_at);
  console.log('');
  console.log('=== PAYLOAD ===');
  try {
    console.log(JSON.stringify(JSON.parse(item.payload), null, 2));
  } catch {
    console.log(item.payload);
  }
} else {
  console.log('Queue item not found');
}

db.close();
