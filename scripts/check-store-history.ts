/**
 * Check store history and configuration
 * Run with: npx ts-node scripts/check-store-history.ts
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Find the database file
const possiblePaths = [
  path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db'),
  path.join(process.env.LOCALAPPDATA || '', 'nuvana', 'nuvana.db'),
  '/c/Users/djmax/AppData/Roaming/nuvana/nuvana.db',
];

let dbPath: string | null = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    dbPath = p;
    break;
  }
}

if (!dbPath) {
  console.error('Database not found');
  process.exit(1);
}

console.log('Database path:', dbPath);
console.log('');

const db = new Database(dbPath, { readonly: true });

// Check ALL stores in the stores table
console.log('=== ALL Stores in Database ===');
const allStores = db
  .prepare(
    `
  SELECT store_id, name, state_id, created_at, updated_at
  FROM stores
  ORDER BY created_at
`
  )
  .all() as Array<{
  store_id: string;
  name: string;
  state_id: string | null;
  created_at: string;
  updated_at: string;
}>;

for (const store of allStores) {
  console.log(`Store: ${store.name}`);
  console.log(`  store_id: ${store.store_id}`);
  console.log(`  state_id: ${store.state_id}`);
  console.log(`  created_at: ${store.created_at}`);
  console.log(`  updated_at: ${store.updated_at}`);
  console.log('');
}

// Check which store_ids are used in various tables
console.log('=== Store IDs Usage Across Tables ===');

const tablesToCheck = [
  'lottery_games',
  'lottery_packs',
  'lottery_bins',
  'lottery_business_days',
  'users',
  'shifts',
  'sync_queue',
];

for (const table of tablesToCheck) {
  try {
    const result = db
      .prepare(
        `
      SELECT DISTINCT store_id, COUNT(*) as count
      FROM ${table}
      GROUP BY store_id
    `
      )
      .all() as Array<{ store_id: string; count: number }>;

    console.log(`${table}:`);
    for (const row of result) {
      // Find matching store name
      const store = allStores.find((s) => s.store_id === row.store_id);
      const storeName = store ? store.name : 'UNKNOWN STORE';
      console.log(`  ${row.store_id} (${storeName}): ${row.count} records`);
    }
  } catch (e) {
    console.log(`${table}: Error - ${(e as Error).message}`);
  }
}

console.log('');

// Check the specific store IDs we found
const currentStoreId = allStores.length > 0 ? allStores[0].store_id : null;
const gameStoreId = 'b8d9e957-d4fc-4463-9b22-08d03b4c585c'; // From earlier query

console.log('=== Store ID Analysis ===');
console.log(`Current store (from stores table): ${currentStoreId}`);
console.log(`Store ID on games: ${gameStoreId}`);

// Check if gameStoreId exists in stores table
const gameStore = allStores.find((s) => s.store_id === gameStoreId);
if (gameStore) {
  console.log(`\nThe games' store_id belongs to: ${gameStore.name}`);
} else {
  console.log(`\nThe games' store_id (${gameStoreId}) does NOT exist in the stores table!`);
  console.log('This means it was from a deleted/reset store.');
}

db.close();
