/**
 * Reset pack sync timestamps to force a full re-sync
 *
 * After migrations v036 (games) and v037 (bins), we need to re-sync all packs
 * because the FK columns now use cloud's UUIDs directly.
 *
 * Run with: npx electron scripts/reset-pack-sync-timestamps.js
 */
let app, safeStorage;
try {
  const electron = require('electron');
  app = electron.app;
  safeStorage = electron.safeStorage;
} catch (e) {
  console.error('Failed to require electron:', e.message);
  process.exit(1);
}

if (!app) {
  console.error('Electron app module not available - are you running this as main process?');
  process.exit(1);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  const Database = require('better-sqlite3-multiple-ciphers');

  const store = new Store({ name: 'nuvana' });
  const storedData = store.get('encryptedDbKey');
  const encryptedBuffer = Buffer.from(storedData);
  const key = safeStorage.decryptString(encryptedBuffer);

  const dbPath = app.getPath('userData') + '/nuvana.db';
  console.log('Database path:', dbPath);

  const db = new Database(dbPath);

  db.pragma(`key = '${key}'`);
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`kdf_iter = 256000`);

  // Show current sync timestamps
  console.log('\n=== CURRENT SYNC TIMESTAMPS ===');
  try {
    const timestamps = db.prepare('SELECT * FROM sync_timestamps').all();
    if (timestamps.length === 0) {
      console.log('  No sync timestamps found');
    } else {
      timestamps.forEach(t => {
        console.log(`  ${t.entity_type}: last_pull_at=${t.last_pull_at}`);
      });
    }
  } catch(e) {
    console.log('Error reading timestamps:', e.message);
  }

  // Delete pack sync timestamps to force full re-sync
  console.log('\n=== DELETING PACK SYNC TIMESTAMPS ===');
  try {
    const deleteStmt = db.prepare(`
      DELETE FROM sync_timestamps
      WHERE entity_type IN ('packs_received', 'packs_activated', 'packs')
    `);
    const result = deleteStmt.run();
    console.log(`  Deleted ${result.changes} pack sync timestamp(s)`);
  } catch(e) {
    console.log('Error deleting timestamps:', e.message);
  }

  // Also clear any existing packs that might have bad FK references
  // This ensures a clean slate for the re-sync
  console.log('\n=== CLEARING EXISTING PACKS (for clean re-sync) ===');
  try {
    const countBefore = db.prepare('SELECT COUNT(*) as c FROM lottery_packs').get();
    console.log(`  Packs before clear: ${countBefore.c}`);

    const deletePacksStmt = db.prepare('DELETE FROM lottery_packs');
    const packResult = deletePacksStmt.run();
    console.log(`  Deleted ${packResult.changes} pack(s)`);
  } catch(e) {
    console.log('Error clearing packs:', e.message);
  }

  // Verify the cleanup
  console.log('\n=== VERIFICATION ===');
  try {
    const timestamps = db.prepare('SELECT * FROM sync_timestamps').all();
    console.log('Remaining sync timestamps:');
    if (timestamps.length === 0) {
      console.log('  None');
    } else {
      timestamps.forEach(t => {
        console.log(`  ${t.entity_type}: last_pull_at=${t.last_pull_at}`);
      });
    }

    const packCount = db.prepare('SELECT COUNT(*) as c FROM lottery_packs').get();
    console.log(`Packs in database: ${packCount.c}`);
  } catch(e) {
    console.log('Error:', e.message);
  }

  db.close();
  console.log('\n=== DONE ===');
  console.log('Restart the app to trigger a full pack sync from cloud.');
  app.quit();
});
