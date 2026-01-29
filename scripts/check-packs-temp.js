const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db');
const db = new Database(dbPath);

// Check the lottery_packs table for these two packs
const packs = db.prepare(`
  SELECT pack_id, pack_number, status, synced_at
  FROM lottery_packs
  WHERE pack_number IN ('0112840', '0315965')
`).all();

console.log('Pack records in lottery_packs:');
packs.forEach(p => console.log(JSON.stringify(p, null, 2)));

// Check the sync history for these packs
console.log('\nSync history for these packs:');
const packIds = packs.map(p => p.pack_id);

if (packIds.length > 0) {
  const placeholders = packIds.map(() => '?').join(',');
  const history = db.prepare(`
    SELECT entity_id, operation, synced, sync_attempts, http_status, last_sync_error, created_at, synced_at
    FROM sync_queue
    WHERE entity_id IN (${placeholders})
    ORDER BY created_at
  `).all(...packIds);

  history.forEach(h => console.log(JSON.stringify(h)));
}

db.close();
