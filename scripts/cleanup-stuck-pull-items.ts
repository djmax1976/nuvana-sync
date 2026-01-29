/**
 * Script to cleanup stuck PULL tracking items in sync queue
 *
 * This script addresses a bug where syncBins() returned early without marking
 * PULL tracking items as synced when the cloud returned an empty bins array.
 * These items accumulated every 5 minutes and cluttered the queue.
 *
 * The bug was fixed in bidirectional-sync.service.ts - this script cleans up
 * any existing stuck items from before the fix was deployed.
 *
 * Usage: npx tsx scripts/cleanup-stuck-pull-items.ts
 *
 * Options:
 *   --dry-run    Show what would be cleaned up without making changes (default)
 *   --execute    Actually perform the cleanup
 *
 * @security This script only modifies sync_queue tracking records.
 *           It does NOT modify actual business data (packs, bins, games, etc.)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Determine the database path based on platform
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

interface StuckItem {
  id: string;
  entity_type: string;
  entity_id: string;
  sync_direction: string;
  sync_attempts: number;
  created_at: string;
}

const dbPath = getDatabasePath();
const isDryRun = !process.argv.includes('--execute');

console.log('=============================================');
console.log('   STUCK PULL QUEUE ITEMS CLEANUP TOOL      ');
console.log('=============================================\n');
console.log('Database path:', dbPath);
console.log('Mode:', isDryRun ? 'DRY RUN (use --execute to apply changes)' : 'EXECUTE');
console.log('');

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.log('\nDatabase file not found. Application may not have been set up yet.');
  process.exit(1);
}

try {
  const db = new Database(dbPath, { readonly: isDryRun });

  // Find stuck PULL tracking items
  // These are items with:
  // - sync_direction = 'PULL'
  // - entity_id starts with 'pull-' (tracking records, not actual data)
  // - synced = 0 (not marked as complete)
  // - sync_attempts = 0 (never processed - they're excluded from retry logic by design)
  const stuckItemsQuery = `
    SELECT id, entity_type, entity_id, sync_direction, sync_attempts, created_at
    FROM sync_queue
    WHERE sync_direction = 'PULL'
      AND entity_id LIKE 'pull-%'
      AND synced = 0
    ORDER BY created_at ASC
  `;

  const stuckItems = db.prepare(stuckItemsQuery).all() as StuckItem[];

  console.log(`Found ${stuckItems.length} stuck PULL tracking items:\n`);

  if (stuckItems.length === 0) {
    console.log('No stuck items found. Queue is clean!');
    db.close();
    process.exit(0);
  }

  // Group by entity type for summary
  const byType: Record<string, StuckItem[]> = {};
  for (const item of stuckItems) {
    const key = item.entity_type;
    if (!byType[key]) byType[key] = [];
    byType[key].push(item);
  }

  console.log('Summary by entity type:');
  for (const [type, items] of Object.entries(byType)) {
    const oldest = items[0].created_at;
    const newest = items[items.length - 1].created_at;
    console.log(`  ${type}: ${items.length} items (${oldest} to ${newest})`);
  }
  console.log('');

  // Show sample of stuck items
  console.log('Sample of stuck items (first 5):');
  for (const item of stuckItems.slice(0, 5)) {
    console.log(`  - ${item.entity_type}/${item.entity_id} created ${item.created_at}`);
  }
  if (stuckItems.length > 5) {
    console.log(`  ... and ${stuckItems.length - 5} more`);
  }
  console.log('');

  if (isDryRun) {
    console.log('=== DRY RUN - No changes made ===');
    console.log('Run with --execute to apply cleanup');
  } else {
    console.log('=== EXECUTING CLEANUP ===');

    // Mark all stuck items as synced with a cleanup note
    const cleanupTime = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE sync_queue
      SET synced = 1,
          synced_at = ?,
          http_status = 200,
          response_body = ?
      WHERE id = ?
    `);

    const cleanupNote = JSON.stringify({
      cleanup: true,
      reason: 'Fixed by cleanup-stuck-pull-items.ts - items were stuck due to early return bug',
      cleaned_at: cleanupTime,
    });

    let cleanedCount = 0;
    const cleanupTransaction = db.transaction(() => {
      for (const item of stuckItems) {
        updateStmt.run(cleanupTime, cleanupNote, item.id);
        cleanedCount++;
      }
    });

    cleanupTransaction();

    console.log(`\nSuccessfully cleaned up ${cleanedCount} stuck items.`);
    console.log('The sync queue should now show accurate pending counts.');
  }

  db.close();
} catch (error) {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
}
