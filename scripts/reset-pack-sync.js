// Script to reset the sync timestamp for packs so they will re-sync
// Run with: npx electron scripts/reset-pack-sync.js

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

  // Check current sync timestamps
  console.log('\n=== CURRENT SYNC TIMESTAMPS ===');
  try {
    const timestamps = db.prepare('SELECT * FROM sync_timestamps').all();
    timestamps.forEach(t => {
      console.log(`  ${t.store_id} / ${t.entity_type}: lastPullAt=${t.last_pull_at}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Reset the sync timestamp for packs_received
  console.log('\n=== RESETTING PACK SYNC TIMESTAMPS ===');
  try {
    const result = db.prepare(`
      DELETE FROM sync_timestamps
      WHERE entity_type IN ('packs_received', 'packs_activated')
    `).run();
    console.log('Deleted rows:', result.changes);
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Verify
  console.log('\n=== SYNC TIMESTAMPS AFTER RESET ===');
  try {
    const timestamps = db.prepare('SELECT * FROM sync_timestamps').all();
    if (timestamps.length === 0) {
      console.log('  (no sync timestamps)');
    } else {
      timestamps.forEach(t => {
        console.log(`  ${t.store_id} / ${t.entity_type}: lastPullAt=${t.last_pull_at}`);
      });
    }
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_packs current state
  console.log('\n=== LOTTERY PACKS STATE ===');
  try {
    const packs = db.prepare('SELECT pack_id, pack_number, status, game_id FROM lottery_packs').all();
    console.log('Total packs:', packs.length);
    packs.forEach(p => {
      console.log(`  ${p.pack_number}: status=${p.status}, game_id=${p.game_id}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  db.close();
  console.log('\n=== DONE ===');
  console.log('Pack sync timestamps have been reset.');
  console.log('Restart the app and trigger a sync to re-pull packs from cloud.');
  app.quit();
});
