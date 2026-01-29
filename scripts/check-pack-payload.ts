/**
 * Script to check payload for a specific pack by pack_number
 * Usage: npx tsx scripts/check-pack-payload.ts [pack_number]
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function getDatabasePath(): string {
  let userDataPath: string;

  if (process.platform === 'win32') {
    userDataPath = path.join(process.env.APPDATA || '', 'nuvana');
  } else if (process.platform === 'darwin') {
    userDataPath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'nuvana');
  } else {
    userDataPath = path.join(process.env.HOME || '', '.config', 'nuvana');
  }

  return path.join(userDataPath, 'nuvana.db');
}

const packNumber = process.argv[2] || '0327710';
const dbPath = getDatabasePath();

console.log('=============================================');
console.log('         PACK PAYLOAD INSPECTOR             ');
console.log('=============================================\n');
console.log('Database path:', dbPath);
console.log('Pack Number:', packNumber);
console.log('');

if (!fs.existsSync(dbPath)) {
  console.log('\nDatabase file not found.');
  process.exit(1);
}

try {
  const db = new Database(dbPath, { readonly: true });

  // Search for pack by pack_number
  console.log('=== PACK DATA ===\n');

  const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_number = ?').get(packNumber) as
    | Record<string, unknown>
    | undefined;

  if (!pack) {
    console.log('Pack not found with pack_number:', packNumber);
    db.close();
    process.exit(1);
  }

  console.log(JSON.stringify(pack, null, 2));

  // Get sync queue items for this pack
  console.log('\n=== SYNC QUEUE ITEMS FOR THIS PACK ===\n');

  const items = db
    .prepare(
      `
    SELECT id, entity_type, operation, sync_direction, synced, sync_attempts, max_attempts,
           api_endpoint, http_status, last_sync_error, payload, response_body, created_at, last_attempt_at
    FROM sync_queue
    WHERE entity_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `
    )
    .all(pack.pack_id as string) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    console.log('No sync queue items found for this pack.');

    // Check if there are any items at all
    const allPending = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0 AND entity_type = 'pack'
    `
      )
      .get() as { count: number };
    console.log(`\nTotal pending pack items in queue: ${allPending.count}`);

    // Show recent failed pack items
    console.log('\n=== RECENT FAILED PACK ITEMS ===\n');
    const failedItems = db
      .prepare(
        `
      SELECT id, entity_id, operation, sync_direction, synced, sync_attempts, max_attempts,
             api_endpoint, http_status, last_sync_error, payload, response_body, created_at, last_attempt_at
      FROM sync_queue
      WHERE entity_type = 'pack' AND synced = 0 AND sync_attempts > 0
      ORDER BY last_attempt_at DESC
      LIMIT 5
    `
      )
      .all() as Array<Record<string, unknown>>;

    for (const item of failedItems) {
      printItem(item);
    }
  } else {
    for (const item of items) {
      printItem(item);
    }
  }

  db.close();
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}

function printItem(item: Record<string, unknown>) {
  console.log('Queue Item ID:', item.id);
  console.log('Entity ID:', item.entity_id);
  console.log('Operation:', item.operation, '| Direction:', item.sync_direction);
  console.log('Synced:', item.synced, '| Attempts:', item.sync_attempts, '/', item.max_attempts);
  console.log('Endpoint:', item.api_endpoint);
  console.log('HTTP Status:', item.http_status);
  console.log('Last Error:', item.last_sync_error);
  console.log('Created:', item.created_at);
  console.log('Last Attempt:', item.last_attempt_at);
  console.log('\n--- PAYLOAD (sent to cloud API) ---\n');
  try {
    const payload = JSON.parse(item.payload as string);
    console.log(JSON.stringify(payload, null, 2));
  } catch {
    console.log(item.payload);
  }
  if (item.response_body) {
    console.log('\n--- RESPONSE BODY ---\n');
    console.log(item.response_body);
  }
  console.log('\n========================================\n');
}
