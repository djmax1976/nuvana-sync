/**
 * Script to check sync queue state and display pack sync status
 *
 * This script:
 * 1. Shows current sync queue statistics
 * 2. Identifies packs by status that may need syncing
 * 3. Does NOT modify any data - use the IPC handlers for actual requeue
 *
 * Usage: npx tsx scripts/check-sync-queue.ts
 *
 * To actually re-enqueue packs, use the application's Developer Tools console:
 *   - window.api.sync.resyncAllPacks()          // Re-enqueue all packs
 *   - window.api.sync.resyncActivePacks()       // Re-enqueue ACTIVE packs
 *   - window.api.sync.resyncDepletedPacks()     // Re-enqueue DEPLETED packs
 *   - window.api.sync.resyncReturnedPacks()     // Re-enqueue RETURNED packs
 *   - window.api.sync.backfillReceivedPacks()   // Re-enqueue RECEIVED packs
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Determine the database path based on platform
// Note: The app name is 'nuvana' not 'nuvana-sync'
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

const dbPath = getDatabasePath();

console.log('=============================================');
console.log('         SYNC QUEUE DIAGNOSTIC TOOL         ');
console.log('=============================================\n');
console.log('Database path:', dbPath);

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.log('\nDatabase file not found. Application may not have been set up yet.');
  process.exit(1);
}

try {
  const db = new Database(dbPath, { readonly: true });

  // Get store info
  const store = db.prepare('SELECT * FROM stores LIMIT 1').get() as
    | { store_id: string; store_name: string }
    | undefined;
  if (!store) {
    console.log('\nNo store configured. Please set up the store first.');
    db.close();
    process.exit(1);
  }
  console.log(`Store: ${store.store_name} (${store.store_id})\n`);

  // =========================================================================
  // 1. Sync Queue Statistics
  // =========================================================================
  console.log('=== SYNC QUEUE STATISTICS ===\n');

  // Total counts
  const totalPending = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0
  `
    )
    .get() as { count: number };
  console.log(`Total pending (not synced): ${totalPending.count}`);

  const totalSynced = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM sync_queue WHERE synced = 1
  `
    )
    .get() as { count: number };
  console.log(`Total synced: ${totalSynced.count}`);

  // Pending by entity type
  const pendingByType = db
    .prepare(
      `
    SELECT entity_type, operation, COUNT(*) as count
    FROM sync_queue
    WHERE synced = 0
    GROUP BY entity_type, operation
    ORDER BY entity_type, operation
  `
    )
    .all() as Array<{ entity_type: string; operation: string; count: number }>;

  if (pendingByType.length > 0) {
    console.log('\nPending by entity type and operation:');
    for (const row of pendingByType) {
      console.log(`  ${row.entity_type} (${row.operation}): ${row.count}`);
    }
  } else {
    console.log('\nNo pending items in sync queue.');
  }

  // Failed items (exceeded max attempts)
  const failedItems = db
    .prepare(
      `
    SELECT entity_type, COUNT(*) as count
    FROM sync_queue
    WHERE synced = 0 AND sync_attempts >= max_attempts
    GROUP BY entity_type
  `
    )
    .all() as Array<{ entity_type: string; count: number }>;

  if (failedItems.length > 0) {
    console.log('\nFailed items (exceeded max retries):');
    for (const row of failedItems) {
      console.log(`  ${row.entity_type}: ${row.count}`);
    }
  }

  // =========================================================================
  // 2. Pack Status Summary
  // =========================================================================
  console.log('\n=== PACK STATUS SUMMARY ===\n');

  // Count packs by status
  const packsByStatus = db
    .prepare(
      `
    SELECT status, COUNT(*) as count
    FROM lottery_packs
    WHERE store_id = ?
    GROUP BY status
    ORDER BY status
  `
    )
    .all(store.store_id) as Array<{ status: string; count: number }>;

  console.log('Packs by status:');
  for (const row of packsByStatus) {
    console.log(`  ${row.status}: ${row.count}`);
  }

  // =========================================================================
  // 3. Packs in Queue Analysis
  // =========================================================================
  console.log('\n=== PACK QUEUE ANALYSIS ===\n');

  // Get pack IDs already in sync queue (pending) for UPDATE/ACTIVATE operations
  const packsInQueue = db
    .prepare(
      `
    SELECT DISTINCT entity_id
    FROM sync_queue
    WHERE entity_type = 'pack'
      AND operation IN ('UPDATE', 'ACTIVATE')
      AND synced = 0
  `
    )
    .all() as Array<{ entity_id: string }>;
  const packsInQueueSet = new Set(packsInQueue.map((p) => p.entity_id));

  console.log(`Pack IDs currently in pending sync queue: ${packsInQueueSet.size}`);

  // Count packs by status that are NOT in the queue
  const statusesToCheck = ['ACTIVE', 'DEPLETED', 'RETURNED'];

  for (const status of statusesToCheck) {
    const packs = db
      .prepare(
        `
      SELECT pack_id, pack_number
      FROM lottery_packs
      WHERE store_id = ? AND status = ?
    `
      )
      .all(store.store_id, status) as Array<{ pack_id: string; pack_number: string }>;

    const notInQueue = packs.filter((p) => !packsInQueueSet.has(p.pack_id));

    console.log(`${status} packs NOT in queue: ${notInQueue.length} / ${packs.length}`);

    // Show first few pack numbers if there are some missing
    if (notInQueue.length > 0 && notInQueue.length <= 10) {
      console.log(`  Pack numbers: ${notInQueue.map((p) => p.pack_number).join(', ')}`);
    } else if (notInQueue.length > 10) {
      console.log(
        `  First 10: ${notInQueue
          .slice(0, 10)
          .map((p) => p.pack_number)
          .join(', ')} ...`
      );
    }
  }

  // =========================================================================
  // 4. Recent Sync Errors (skipped - column structure may vary)
  // =========================================================================
  console.log('\n=== RECENT SYNC ERRORS ===\n');
  console.log('(Check Sync Monitor in app for detailed error info)');

  // =========================================================================
  // 5. Instructions
  // =========================================================================
  console.log('\n=== HOW TO RE-ENQUEUE PACKS ===\n');
  console.log('Open the application and use Developer Tools (F12 or Ctrl+Shift+I):');
  console.log('');
  console.log('  // Re-enqueue ALL packs (ACTIVE + DEPLETED + RETURNED)');
  console.log('  await window.api.sync.resyncAllPacks()');
  console.log('');
  console.log('  // Or individually by status:');
  console.log('  await window.api.sync.resyncActivePacks()');
  console.log('  await window.api.sync.resyncDepletedPacks()');
  console.log('  await window.api.sync.resyncReturnedPacks()');
  console.log('  await window.api.sync.backfillReceivedPacks()');
  console.log('');
  console.log('After re-enqueuing, trigger a sync:');
  console.log('  await window.api.sync.triggerNow()');
  console.log('');

  db.close();
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
