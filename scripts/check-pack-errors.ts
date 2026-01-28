import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Check lottery_games table structure and data
console.log('=== LOTTERY_GAMES TABLE ===');
const gamesSchema = db.prepare(`PRAGMA table_info(lottery_games)`).all() as any[];
console.log('Columns:', gamesSchema.map((c) => c.name).join(', '));

const gamesCount = db.prepare(`SELECT COUNT(*) as count FROM lottery_games`).get() as any;
console.log('Total games:', gamesCount.count);

if (gamesCount.count > 0) {
  const games = db.prepare(`SELECT * FROM lottery_games LIMIT 5`).all() as any[];
  console.log('Sample games:');
  games.forEach((g) => console.log('  ', JSON.stringify(g)));
}

// Check lottery_packs table structure and data
console.log('');
console.log('=== LOTTERY_PACKS TABLE ===');
const packsSchema = db.prepare(`PRAGMA table_info(lottery_packs)`).all() as any[];
console.log('Columns:', packsSchema.map((c) => c.name).join(', '));

const packsCount = db.prepare(`SELECT COUNT(*) as count FROM lottery_packs`).get() as any;
console.log('Total packs:', packsCount.count);

if (packsCount.count > 0) {
  const packs = db.prepare(`SELECT * FROM lottery_packs LIMIT 5`).all() as any[];
  console.log('Sample packs:');
  packs.forEach((p) => console.log('  ', JSON.stringify(p)));
}

// Check sync_queue PULL items for packs
console.log('');
console.log('=== RECENT PULL SYNC ITEMS (pack type) ===');
const pullItems = db
  .prepare(
    `
  SELECT id, entity_id, response_body, last_sync_error, created_at, synced
  FROM sync_queue
  WHERE sync_direction = 'PULL'
    AND entity_type = 'pack'
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all() as any[];

pullItems.forEach((item) => {
  console.log(`  ${item.entity_id}: ${item.response_body} (synced=${item.synced})`);
  if (item.last_sync_error) {
    console.log(`    Error: ${item.last_sync_error}`);
  }
});

// Check sync_queue PULL items for games
console.log('');
console.log('=== RECENT PULL SYNC ITEMS (game type) ===');
const gamePullItems = db
  .prepare(
    `
  SELECT id, entity_id, response_body, last_sync_error, created_at, synced
  FROM sync_queue
  WHERE sync_direction = 'PULL'
    AND entity_type = 'game'
  ORDER BY created_at DESC
  LIMIT 10
`
  )
  .all() as any[];

if (gamePullItems.length === 0) {
  console.log('  No game pull items found');
} else {
  gamePullItems.forEach((item) => {
    console.log(`  ${item.entity_id}: ${item.response_body} (synced=${item.synced})`);
  });
}

// Check all entity types in sync_queue
console.log('');
console.log('=== SYNC QUEUE ENTITY TYPES ===');
const entityTypes = db
  .prepare(
    `
  SELECT entity_type, sync_direction, COUNT(*) as count
  FROM sync_queue
  GROUP BY entity_type, sync_direction
  ORDER BY entity_type, sync_direction
`
  )
  .all() as any[];

entityTypes.forEach((e) => {
  console.log(`  ${e.entity_type} (${e.sync_direction}): ${e.count}`);
});

db.close();
