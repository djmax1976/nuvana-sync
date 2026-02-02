import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

// Find the database - user specified location
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath, { readonly: true });

// Get store ID first
const store = db.prepare('SELECT store_id FROM stores LIMIT 1').get();
console.log('Store:', store);

if (store) {
  // Get all bins for this store
  const bins = db.prepare('SELECT bin_id, name, display_order, is_active, deleted_at FROM lottery_bins WHERE store_id = ? ORDER BY display_order ASC').all(store.store_id);
  console.log('\nAll bins for store:');
  bins.forEach(bin => {
    const binNumber = bin.display_order + 1;
    console.log(`  display_order=${bin.display_order} -> bin_number=${binNumber} | name="${bin.name}" | is_active=${bin.is_active} | deleted=${bin.deleted_at ? 'YES' : 'no'}`);
  });
  console.log(`\nTotal bins: ${bins.length}`);

  // Check if there's a bin with display_order=0
  const bin0 = bins.find(b => b.display_order === 0);
  if (!bin0) {
    console.log('\n⚠️  NO BIN WITH display_order=0 FOUND!');
    console.log('   This means "Bin 1" will not appear in the dropdown.');
    console.log('   Minimum display_order:', Math.min(...bins.map(b => b.display_order)));
  }
}

db.close();
