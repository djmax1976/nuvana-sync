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

  // Check migration version
  console.log('\n=== MIGRATION VERSION ===');
  try {
    const version = db.pragma('user_version', { simple: true });
    console.log('Current DB version:', version);
  } catch(e) {
    console.log('Error getting version:', e.message);
  }

  // Check lottery_bins schema
  console.log('\n=== LOTTERY_BINS SCHEMA ===');
  try {
    const schema = db.prepare("PRAGMA table_info(lottery_bins)").all();
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_games schema
  console.log('\n=== LOTTERY_GAMES SCHEMA ===');
  try {
    const schema = db.prepare("PRAGMA table_info(lottery_games)").all();
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_packs schema
  console.log('\n=== LOTTERY_PACKS SCHEMA ===');
  try {
    const schema = db.prepare("PRAGMA table_info(lottery_packs)").all();
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.pk ? 'PRIMARY KEY' : ''}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_bins data
  console.log('\n=== LOTTERY_BINS DATA ===');
  try {
    const bins = db.prepare('SELECT * FROM lottery_bins LIMIT 5').all();
    console.log('Sample bins:', bins.length);
    bins.forEach(bin => {
      console.log(`  bin_id=${bin.bin_id}`);
      console.log(`    bin_number=${bin.bin_number}, store_id=${bin.store_id}`);
      console.log(`    cloud_bin_id=${bin.cloud_bin_id || 'N/A (column may not exist)'}`);
      console.log(`    synced_at=${bin.synced_at}, status=${bin.status}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_games data
  console.log('\n=== LOTTERY_GAMES DATA ===');
  try {
    const games = db.prepare('SELECT * FROM lottery_games LIMIT 5').all();
    console.log('Sample games:', games.length);
    games.forEach(game => {
      console.log(`  game_id=${game.game_id}`);
      console.log(`    name=${game.name}, game_code=${game.game_code}`);
      console.log(`    cloud_game_id=${game.cloud_game_id || 'N/A (column may not exist)'}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_packs data with focus on FK columns
  console.log('\n=== LOTTERY_PACKS DATA (FOCUS ON FK) ===');
  try {
    const packs = db.prepare('SELECT pack_id, pack_number, status, current_bin_id, game_id, received_by, activated_by, activated_shift_id FROM lottery_packs LIMIT 10').all();
    console.log('Sample packs:', packs.length);
    packs.forEach(pack => {
      console.log(`  ${pack.pack_number} (${pack.status}):`);
      console.log(`    game_id=${pack.game_id}`);
      console.log(`    current_bin_id=${pack.current_bin_id}`);
      console.log(`    received_by=${pack.received_by}`);
      console.log(`    activated_by=${pack.activated_by}`);
      console.log(`    activated_shift_id=${pack.activated_shift_id}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check if current_bin_id values exist in lottery_bins
  console.log('\n=== FK CHECK: current_bin_id -> lottery_bins.bin_id ===');
  try {
    const orphanBins = db.prepare(`
      SELECT p.pack_number, p.current_bin_id
      FROM lottery_packs p
      WHERE p.current_bin_id IS NOT NULL
        AND p.current_bin_id NOT IN (SELECT bin_id FROM lottery_bins)
    `).all();
    if (orphanBins.length === 0) {
      console.log('  All current_bin_id values have matching bins - OK');
    } else {
      console.log('  ORPHAN PACKS (bin_id not found):');
      orphanBins.forEach(p => {
        console.log(`    ${p.pack_number}: current_bin_id=${p.current_bin_id}`);
      });
    }
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check if game_id values exist in lottery_games
  console.log('\n=== FK CHECK: game_id -> lottery_games.game_id ===');
  try {
    const orphanGames = db.prepare(`
      SELECT p.pack_number, p.game_id
      FROM lottery_packs p
      WHERE p.game_id IS NOT NULL
        AND p.game_id NOT IN (SELECT game_id FROM lottery_games)
    `).all();
    if (orphanGames.length === 0) {
      console.log('  All game_id values have matching games - OK');
    } else {
      console.log('  ORPHAN PACKS (game_id not found):');
      orphanGames.forEach(p => {
        console.log(`    ${p.pack_number}: game_id=${p.game_id}`);
      });
    }
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check sync_timestamps
  console.log('\n=== SYNC TIMESTAMPS ===');
  try {
    const timestamps = db.prepare('SELECT * FROM sync_timestamps').all();
    timestamps.forEach(t => {
      console.log(`  ${t.entity_type}: last_pull_at=${t.last_pull_at}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  db.close();
  console.log('\n=== DONE ===');
  app.quit();
});
