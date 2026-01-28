import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

const item = db
  .prepare(
    `
  SELECT response_body, api_endpoint, payload, last_sync_error
  FROM sync_queue
  WHERE synced = 0
  LIMIT 1
`
  )
  .get() as any;

if (item) {
  console.log('API Endpoint:', item.api_endpoint || 'Not recorded');
  console.log('Last Error:', item.last_sync_error || 'None');
  console.log('Response Body:', item.response_body || 'Not recorded');
  console.log('');
  console.log('=== PAYLOAD BEING SENT ===');
  console.log(JSON.stringify(JSON.parse(item.payload), null, 2));
} else {
  console.log('No pending items found');
}

db.close();
