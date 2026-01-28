/**
 * Check game store IDs to diagnose mismatch issue
 * Run with: npx ts-node scripts/check-game-store-ids.ts
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Find the database file
const possiblePaths = [
  path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db'),
  path.join(process.env.LOCALAPPDATA || '', 'nuvana', 'nuvana.db'),
  '/c/Users/djmax/AppData/Roaming/nuvana/nuvana.db',
  './nuvana.db',
];

let dbPath: string | null = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('Database not found. Checked paths:', possiblePaths);
  process.exit(1);
}

console.log('Database path:', dbPath);
console.log('');

const db = new Database(dbPath, { readonly: true });

// First, list tables to understand the schema
const tables = db
  .prepare(
    `
  SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
`
  )
  .all() as Array<{ name: string }>;

console.log('=== Tables in database ===');
for (const t of tables) {
  console.log(`  ${t.name}`);
}
console.log('');

// Try to get store info from stores table
let config: Record<string, string> = {};
try {
  const storeResult = db
    .prepare(
      `
    SELECT store_id, name as store_name, state_id FROM stores LIMIT 1
  `
    )
    .get() as { store_id: string; store_name: string; state_id: string } | undefined;

  if (storeResult) {
    config = {
      store_id: storeResult.store_id,
      store_name: storeResult.store_name,
      state_id: storeResult.state_id,
    };
  }
} catch (e) {
  // Try settings table
  try {
    const settingsResult = db
      .prepare(
        `
      SELECT key, value FROM settings WHERE key IN ('store_id', 'store_name', 'state_id')
    `
      )
      .all() as Array<{ key: string; value: string }>;
    for (const row of settingsResult) {
      config[row.key] = row.value;
    }
  } catch (e2) {
    console.log('Could not find store config in stores or settings tables');
  }
}

console.log('=== Current Store Config ===');
for (const [key, value] of Object.entries(config)) {
  console.log(`${key}: ${value}`);
}
console.log('');

// Get unique store IDs from games
const gameStoreIds = db
  .prepare(
    `
  SELECT DISTINCT store_id, COUNT(*) as game_count
  FROM lottery_games
  WHERE deleted_at IS NULL
  GROUP BY store_id
`
  )
  .all() as Array<{ store_id: string; game_count: number }>;

console.log('=== Store IDs in lottery_games table ===');
for (const row of gameStoreIds) {
  const match = row.store_id === config.store_id ? ' ✓ MATCHES CURRENT' : ' ✗ MISMATCH';
  console.log(`store_id: ${row.store_id} (${row.game_count} games)${match}`);
}
console.log('');

// Show some sample games with mismatched store_id
if (config.store_id) {
  const mismatchedGames = db
    .prepare(
      `
    SELECT game_id, game_code, name, store_id, status
    FROM lottery_games
    WHERE store_id != ? AND deleted_at IS NULL
    LIMIT 10
  `
    )
    .all(config.store_id) as Array<{
    game_id: string;
    game_code: string;
    name: string;
    store_id: string;
    status: string;
  }>;

  if (mismatchedGames.length > 0) {
    console.log('=== Sample Games with MISMATCHED store_id ===');
    for (const game of mismatchedGames) {
      console.log(`  ${game.game_code} - ${game.name}`);
      console.log(`    game_id: ${game.game_id}`);
      console.log(`    store_id: ${game.store_id} (should be ${config.store_id})`);
      console.log(`    status: ${game.status}`);
      console.log('');
    }
  } else {
    console.log('=== No mismatched games found ===');
  }

  // Check specifically for game code 1835 that was in the logs
  const game1835 = db
    .prepare(
      `
    SELECT game_id, game_code, name, store_id, status
    FROM lottery_games
    WHERE game_code = '1835'
  `
    )
    .all() as Array<{
    game_id: string;
    game_code: string;
    name: string;
    store_id: string;
    status: string;
  }>;

  if (game1835.length > 0) {
    console.log('=== Game 1835 (from your error log) ===');
    for (const game of game1835) {
      const match = game.store_id === config.store_id ? '✓ MATCHES' : '✗ MISMATCH';
      console.log(`  ${game.game_code} - ${game.name}`);
      console.log(`    game_id: ${game.game_id}`);
      console.log(`    store_id: ${game.store_id} (${match})`);
      console.log(`    current store_id: ${config.store_id}`);
      console.log('');
    }
  }
}

db.close();
