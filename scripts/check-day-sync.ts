/**
 * Check day open/close sync history
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db');
const db = new Database(dbPath);

// Check sync_queue schema
console.log('=== SYNC_QUEUE SCHEMA ===');
const schema = db.prepare(`PRAGMA table_info(sync_queue)`).all();
schema.forEach((col: any) => console.log(`  - ${col.name} (${col.type})`));

// Check sync queue for day_open and day_close items
console.log('\n=== SYNC QUEUE (day_open / day_close) ===');
const syncHistory = db
  .prepare(
    `
  SELECT *
  FROM sync_queue
  WHERE entity_type IN ('day_open', 'day_close')
  ORDER BY created_at DESC
  LIMIT 20
`
  )
  .all();
console.log(JSON.stringify(syncHistory, null, 2));

// Also check for entity_id matching the failed day
console.log('\n=== SYNC QUEUE BY ENTITY ID (dbfcfe16-829e-4ae4-a610-e0d2bcd7e3c5) ===');
const byEntityId = db
  .prepare(
    `
  SELECT *
  FROM sync_queue
  WHERE entity_id = 'dbfcfe16-829e-4ae4-a610-e0d2bcd7e3c5'
`
  )
  .all();
console.log(JSON.stringify(byEntityId, null, 2));

db.close();
