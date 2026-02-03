/**
 * Check pending sync items and their details
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== PENDING SYNC ITEMS ===\n');

const pending = db
  .prepare(
    `
  SELECT id, entity_type, entity_id, operation, sync_attempts, max_attempts,
         last_sync_error, last_attempt_at, retry_after, dead_lettered,
         error_category, api_endpoint, http_status
  FROM sync_queue
  WHERE synced = 0
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all();

console.log(JSON.stringify(pending, null, 2));

console.log('\n=== SYNC ENGINE STATE ===\n');

// Check if there are items in backoff
const backoffItems = db
  .prepare(
    `
  SELECT COUNT(*) as count FROM sync_queue
  WHERE synced = 0 AND dead_lettered = 0
    AND retry_after > datetime('now')
`
  )
  .get() as { count: number };

console.log(`Items in backoff (waiting for retry): ${backoffItems.count}`);

const retryableNow = db
  .prepare(
    `
  SELECT COUNT(*) as count FROM sync_queue
  WHERE synced = 0 AND dead_lettered = 0
    AND sync_attempts < max_attempts
    AND (retry_after IS NULL OR retry_after <= datetime('now'))
`
  )
  .get() as { count: number };

console.log(`Items retryable now: ${retryableNow.count}`);

const dlqCount = db
  .prepare(
    `
  SELECT COUNT(*) as count FROM sync_queue
  WHERE dead_lettered = 1
`
  )
  .get() as { count: number };

console.log(`Items in DLQ: ${dlqCount.count}`);

db.close();
