/**
 * Check all pending pack items in sync queue
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== ALL PENDING PACK ITEMS ===\n');

const pending = db
  .prepare(
    `
  SELECT id, entity_id, operation, payload, sync_attempts, max_attempts, http_status, last_sync_error, api_endpoint, response_body
  FROM sync_queue
  WHERE entity_type = 'pack' AND synced = 0
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all() as Array<Record<string, unknown>>;

console.log('Count:', pending.length);
console.log('');

for (const p of pending) {
  const payload = JSON.parse(p.payload as string);
  console.log('Queue ID:', p.id);
  console.log('Entity ID:', p.entity_id);
  console.log('Pack Number:', payload.pack_number);
  console.log('Status:', payload.status);
  console.log('Operation:', p.operation);
  console.log('Attempts:', p.sync_attempts, '/', p.max_attempts, '| HTTP:', p.http_status);
  console.log('Endpoint:', p.api_endpoint);
  console.log('Error:', p.last_sync_error);
  if (p.response_body) {
    console.log('Response:', p.response_body);
  }
  console.log('\nFull Payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n---\n');
}

// Also check for recently synced RETURNED items
console.log('=== RECENTLY SYNCED PACK ITEMS (RETURNED status) ===\n');

const synced = db
  .prepare(
    `
  SELECT id, entity_id, operation, payload, sync_attempts, http_status, last_sync_error, api_endpoint, response_body, synced_at
  FROM sync_queue
  WHERE entity_type = 'pack' AND synced = 1
  ORDER BY synced_at DESC
  LIMIT 10
`
  )
  .all() as Array<Record<string, unknown>>;

for (const p of synced) {
  const payload = JSON.parse(p.payload as string);
  if (payload.status === 'RETURNED') {
    console.log('Queue ID:', p.id);
    console.log('Pack Number:', payload.pack_number);
    console.log('Status:', payload.status);
    console.log('Synced At:', p.synced_at);
    console.log('HTTP:', p.http_status);
    console.log('Endpoint:', p.api_endpoint);
    console.log('---');
  }
}

db.close();
