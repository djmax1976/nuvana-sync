/**
 * Debug script to check bins and trigger sync
 * Run via: npx electron --require ts-node/register scripts/debug-bins-sync.ts
 */
import { app } from 'electron';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    // Import services after app is ready
    const { databaseService } = await import('../src/main/services/database.service');
    const { cloudApiService } = await import('../src/main/services/cloud-api.service');
    const { bidirectionalSyncService } = await import('../src/main/services/bidirectional-sync.service');
    const { storesDAL } = await import('../src/main/dal/stores.dal');
    const { lotteryBinsDAL } = await import('../src/main/dal/lottery-bins.dal');

    // Initialize database
    console.log('\n=== INITIALIZING DATABASE ===\n');
    databaseService.initialize();

    const db = databaseService.getDatabase();

    // Check stores
    console.log('\n=== STORES ===\n');
    const stores = db.prepare('SELECT store_id, name, status FROM stores').all();
    console.log('Stores in DB:', stores);

    const configuredStore = storesDAL.getConfiguredStore();
    console.log('Configured store:', configuredStore?.store_id, configuredStore?.name);

    // Check current bins in DB
    console.log('\n=== CURRENT BINS IN DATABASE ===\n');
    const bins = db.prepare('SELECT bin_id, store_id, bin_number, label, status, cloud_bin_id FROM lottery_bins').all();
    console.log('Bins count:', bins.length);
    bins.forEach((bin: any) => {
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
        pullResponse.bins.forEach((bin: any, i: number) => {
          console.log(`  [${i}] bin_id: ${bin.bin_id}, bin_number: ${bin.bin_number}, label: ${bin.label}, status: ${bin.status}`);
        });
      } else {
        console.log('  NO BINS RETURNED FROM CLOUD!');
      }
    } catch (error) {
      console.error('Failed to pull bins:', error);
    }

    // Run full sync
    console.log('\n=== RUNNING FULL BINS SYNC ===\n');
    try {
      const syncResult = await bidirectionalSyncService.syncBins();
      console.log('Sync result:', syncResult);
    } catch (error) {
      console.error('Sync failed:', error);
    }

    // Check bins again after sync
    console.log('\n=== BINS AFTER SYNC ===\n');
    const binsAfter = db.prepare('SELECT bin_id, store_id, bin_number, label, status, cloud_bin_id FROM lottery_bins').all();
    console.log('Bins count:', binsAfter.length);
    binsAfter.forEach((bin: any) => {
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
