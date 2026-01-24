/**
 * Debug script to check bins and trigger sync
 * Run via: npx electron scripts/debug-bins-sync.cjs
 */
const { app } = require('electron');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    // Set NODE_ENV for proper imports
    process.env.NODE_ENV = 'development';

    // Import the compiled services
    const path = require('path');
    const distPath = path.join(__dirname, '..', 'out', 'main');

    console.log('\n=== DEBUG BINS SYNC ===\n');
    console.log('Looking for compiled code in:', distPath);

    // Check if we have compiled code
    const fs = require('fs');
    if (!fs.existsSync(distPath)) {
      console.error('ERROR: Compiled code not found. Run "npm run build" first.');
      app.quit();
      return;
    }

    // Import from compiled output
    const { databaseService } = require(path.join(distPath, 'services', 'database.service.js'));
    const { cloudApiService } = require(path.join(distPath, 'services', 'cloud-api.service.js'));
    const { bidirectionalSyncService } = require(path.join(distPath, 'services', 'bidirectional-sync.service.js'));
    const { storesDAL } = require(path.join(distPath, 'dal', 'stores.dal.js'));

    // Initialize database
    console.log('\n=== INITIALIZING DATABASE ===\n');
    databaseService.initialize();

    const db = databaseService.getDatabase();

    // Check stores
    console.log('\n=== STORES ===\n');
    const stores = db.prepare('SELECT store_id, name, status FROM stores').all();
    console.log('Stores in DB:', JSON.stringify(stores, null, 2));

    const configuredStore = storesDAL.getConfiguredStore();
    console.log('Configured store:', configuredStore?.store_id, configuredStore?.name);

    // Check current bins in DB
    console.log('\n=== CURRENT BINS IN DATABASE ===\n');
    const bins = db.prepare('SELECT bin_id, store_id, bin_number, label, status, cloud_bin_id FROM lottery_bins').all();
    console.log('Bins count:', bins.length);
    bins.forEach((bin) => {
      console.log(`  Bin #${bin.bin_number}: ${bin.label || 'no label'} | store: ${bin.store_id} | cloud_id: ${bin.cloud_bin_id || 'none'}`);
    });

    // Try to pull bins from cloud
    console.log('\n=== PULLING BINS FROM CLOUD ===\n');
    try {
      const pullResponse = await cloudApiService.pullBins();
      console.log('Pull response:');
      console.log('  totalCount:', pullResponse.totalCount);
      console.log('  bins.length:', pullResponse.bins?.length ?? 0);
      if (pullResponse.bins && pullResponse.bins.length > 0) {
        pullResponse.bins.forEach((bin, i) => {
          console.log(`  [${i}] bin_id: ${bin.bin_id}, bin_number: ${bin.bin_number}, label: ${bin.label}, status: ${bin.status}`);
        });
      } else {
        console.log('  NO BINS RETURNED FROM CLOUD!');
      }
    } catch (error) {
      console.error('Failed to pull bins:', error.message);
      console.error('Full error:', error);
    }

    // Run full sync
    console.log('\n=== RUNNING FULL BINS SYNC ===\n');
    try {
      const syncResult = await bidirectionalSyncService.syncBins();
      console.log('Sync result:', JSON.stringify(syncResult, null, 2));
    } catch (error) {
      console.error('Sync failed:', error.message);
    }

    // Check bins again after sync
    console.log('\n=== BINS AFTER SYNC ===\n');
    const binsAfter = db.prepare('SELECT bin_id, store_id, bin_number, label, status, cloud_bin_id FROM lottery_bins').all();
    console.log('Bins count:', binsAfter.length);
    binsAfter.forEach((bin) => {
      console.log(`  Bin #${bin.bin_number}: ${bin.label || 'no label'} | store: ${bin.store_id} | cloud_id: ${bin.cloud_bin_id || 'none'}`);
    });

    databaseService.close();
    console.log('\n=== DONE ===\n');
    app.quit();
  } catch (error) {
    console.error('Script error:', error);
    app.quit();
  }
});
