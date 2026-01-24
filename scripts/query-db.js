let app, safeStorage;
try {
  const electron = require('electron');
  console.log('Electron module:', Object.keys(electron));
  app = electron.app;
  safeStorage = electron.safeStorage;
  console.log('app:', typeof app, 'safeStorage:', typeof safeStorage);
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

  // List all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('\n=== TABLES ===');
  tables.forEach(t => console.log('-', t.name));

  // Show row counts
  console.log('\n=== ROW COUNTS ===');
  tables.forEach(t => {
    try {
      const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
      console.log(`${t.name}: ${count.c} rows`);
    } catch(e) {}
  });

  // Check lottery_bins specifically
  console.log('\n=== LOTTERY BINS ===');
  try {
    const bins = db.prepare('SELECT * FROM lottery_bins').all();
    console.log('Total bins:', bins.length);
    bins.forEach(bin => {
      console.log(`  Bin #${bin.bin_number}: label="${bin.label}" | store_id=${bin.store_id} | cloud_bin_id=${bin.cloud_bin_id} | status=${bin.status}`);
    });
  } catch(e) {
    console.log('Error querying lottery_bins:', e.message);
  }

  // Check stores
  console.log('\n=== STORES ===');
  try {
    const stores = db.prepare('SELECT store_id, name, status FROM stores').all();
    stores.forEach(s => {
      console.log(`  ${s.store_id}: ${s.name} (${s.status})`);
    });
  } catch(e) {
    console.log('Error querying stores:', e.message);
  }

  // Check lottery_packs - especially ACTIVATED ones
  console.log('\n=== LOTTERY PACKS (ALL) ===');
  try {
    const packs = db.prepare('SELECT pack_id, pack_number, status, bin_id, store_id, activated_at, opening_serial FROM lottery_packs ORDER BY status').all();
    console.log('Total packs:', packs.length);

    const byStatus = {};
    packs.forEach(p => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    });
    console.log('By status:', JSON.stringify(byStatus));

    console.log('\n=== ACTIVATED PACKS ===');
    const activatedPacks = packs.filter(p => p.status === 'ACTIVATED');
    if (activatedPacks.length === 0) {
      console.log('  NO ACTIVATED PACKS FOUND');
    } else {
      activatedPacks.forEach(p => {
        console.log(`  Pack ${p.pack_number}: bin_id=${p.bin_id} | store_id=${p.store_id} | activated_at=${p.activated_at} | opening_serial=${p.opening_serial}`);
      });
    }
  } catch(e) {
    console.log('Error querying lottery_packs:', e.message);
  }

  db.close();
  app.quit();
});
