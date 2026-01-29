/**
 * Script to check a specific sync queue item's payload
 * Usage: npx tsx scripts/check-queue-item.ts <queue_id>
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

const queueId = process.argv[2] || 'ed48389f-11f9-4858-935f-e357c8eec5e4';
const dbPath = getDatabasePath();

console.log('=============================================');
console.log('         SYNC QUEUE ITEM INSPECTOR          ');
console.log('=============================================\n');
console.log('Database path:', dbPath);
console.log('Queue ID:', queueId);
console.log('');

if (!fs.existsSync(dbPath)) {
  console.log('\nDatabase file not found.');
  process.exit(1);
}

try {
  const db = new Database(dbPath, { readonly: true });

  // Get the queue item
  const item = db
    .prepare(
      `
    SELECT * FROM sync_queue WHERE id = ?
  `
    )
    .get(queueId) as Record<string, unknown> | undefined;

  if (!item) {
    console.log('\nQueue item not found. Trying entity_id search...');

    // Try searching by entity_id
    const items = db
      .prepare(
        `
      SELECT * FROM sync_queue
      WHERE entity_id = ? OR entity_id LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `
      )
      .all(queueId, `%${queueId}%`) as Array<Record<string, unknown>>;

    if (items.length === 0) {
      console.log('No items found.');
      db.close();
      process.exit(1);
    }

    console.log(`\nFound ${items.length} items:\n`);
    for (const i of items) {
      printItem(i);
    }
    db.close();
    process.exit(0);
  }

  printItem(item);

  // Also get the pack data from lottery_packs
  if (item.entity_type === 'pack' && item.entity_id) {
    console.log('\n--- CURRENT PACK DATA IN lottery_packs ---\n');
    const pack = db
      .prepare(
        `
      SELECT * FROM lottery_packs WHERE pack_id = ?
    `
      )
      .get(item.entity_id as string) as Record<string, unknown> | undefined;

    if (pack) {
      console.log(JSON.stringify(pack, null, 2));
    } else {
      console.log('Pack not found in lottery_packs table');
    }
  }

  db.close();
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}

function printItem(item: Record<string, unknown>) {
  console.log('--- QUEUE ITEM ---\n');
  console.log(`ID:           ${item.id}`);
  console.log(`Entity Type:  ${item.entity_type}`);
  console.log(`Entity ID:    ${item.entity_id}`);
  console.log(`Operation:    ${item.operation}`);
  console.log(`Direction:    ${item.sync_direction}`);
  console.log(`Synced:       ${item.synced}`);
  console.log(`Attempts:     ${item.sync_attempts} / ${item.max_attempts}`);
  console.log(`Created:      ${item.created_at}`);
  console.log(`Last Attempt: ${item.last_attempt_at}`);
  console.log(`API Endpoint: ${item.api_endpoint}`);
  console.log(`HTTP Status:  ${item.http_status}`);
  console.log(`Last Error:   ${item.last_sync_error}`);

  console.log('\n--- PAYLOAD (what is sent to cloud) ---\n');
  try {
    const payload = JSON.parse(item.payload as string);
    console.log(JSON.stringify(payload, null, 2));
  } catch {
    console.log(item.payload);
  }

  if (item.response_body) {
    console.log('\n--- RESPONSE BODY ---\n');
    try {
      const response = JSON.parse(item.response_body as string);
      console.log(JSON.stringify(response, null, 2));
    } catch {
      console.log(item.response_body);
    }
  }

  console.log('\n');
}
