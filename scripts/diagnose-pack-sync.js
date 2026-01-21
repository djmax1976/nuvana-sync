const { app, safeStorage } = require('electron');

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  const Database = require('better-sqlite3-multiple-ciphers');

  const store = new Store({ name: 'nuvana' });

  const dbPath = app.getPath('userData') + '/nuvana.db';
  console.log('Database path:', dbPath);

  const db = new Database(dbPath);

  // Check lottery_games
  console.log('\n=== LOTTERY_GAMES IN LOCAL DB ===');
  try {
    const games = db.prepare("SELECT game_id, game_code, name FROM lottery_games").all();
    console.log(`Total games: ${games.length}`);
    games.forEach(g => {
      console.log(`  ${g.game_id} | ${g.game_code} | ${g.name}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_packs
  console.log('\n=== LOTTERY_PACKS IN LOCAL DB ===');
  try {
    const packs = db.prepare("SELECT pack_id, pack_number, game_id, status FROM lottery_packs").all();
    console.log(`Total packs: ${packs.length}`);
    packs.forEach(p => {
      console.log(`  ${p.pack_number} | game_id: ${p.game_id} | status: ${p.status}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check for packs with missing game_id references
  console.log('\n=== PACKS WITH MISSING GAME REFERENCES ===');
  try {
    const orphanPacks = db.prepare(`
      SELECT p.pack_id, p.pack_number, p.game_id, p.status
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      WHERE g.game_id IS NULL
    `).all();
    console.log(`Orphan packs (game_id not in lottery_games): ${orphanPacks.length}`);
    orphanPacks.forEach(p => {
      console.log(`  ${p.pack_number} | game_id: ${p.game_id} | status: ${p.status}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check foreign key status
  console.log('\n=== FOREIGN KEY STATUS ===');
  try {
    const fkStatus = db.prepare("PRAGMA foreign_keys").get();
    console.log(`Foreign keys enabled: ${fkStatus.foreign_keys}`);
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check sync_queue for pending pack items
  console.log('\n=== SYNC_QUEUE PACK ITEMS ===');
  try {
    const queueItems = db.prepare(`
      SELECT entity_id, operation, status, error_message, payload
      FROM sync_queue
      WHERE entity_type = 'pack'
      ORDER BY created_at DESC
      LIMIT 10
    `).all();
    console.log(`Pack items in sync queue: ${queueItems.length}`);
    queueItems.forEach(q => {
      console.log(`  ${q.entity_id} | ${q.operation} | ${q.status}`);
      if (q.error_message) {
        console.log(`    Error: ${q.error_message}`);
      }
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  db.close();
  app.quit();
});
