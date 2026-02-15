const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(process.env.APPDATA, 'nuvana', 'nuvana.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== CURRENT TIME:', new Date().toISOString(), '===\n');

// Check lottery_bins
console.log('=== LOTTERY BINS ===');
const bins = db.prepare(`
  SELECT bin_id, display_order, name, is_active
  FROM lottery_bins
  ORDER BY display_order
`).all();
bins.forEach(b => {
  console.log(`Bin ${b.display_order + 1}: ${b.name} (id: ${b.bin_id.slice(0,8)}..., active: ${b.is_active})`);
});

// Check returned packs with their bin info
console.log('\n=== RETURNED PACKS - BIN INFO ===');
const returnedPacks = db.prepare(`
  SELECT
    p.pack_number,
    p.current_bin_id,
    b.display_order as bin_display_order,
    b.name as bin_name,
    g.name as game_name
  FROM lottery_packs p
  LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
  LEFT JOIN lottery_games g ON p.game_id = g.game_id
  WHERE p.status = 'RETURNED'
`).all();
returnedPacks.forEach(p => {
  console.log(`Pack ${p.pack_number} (${p.game_name}):`);
  console.log(`  current_bin_id: ${p.current_bin_id || 'NULL'}`);
  console.log(`  bin_display_order: ${p.bin_display_order}`);
  console.log(`  Displayed bin number would be: ${(p.bin_display_order ?? 0) + 1}`);
});

// Check all packs with their bin info
console.log('\n=== ALL PACKS (ACTIVE/RETURNED/DEPLETED) - BIN INFO ===');
const allPacks = db.prepare(`
  SELECT
    p.pack_number,
    p.status,
    p.current_bin_id,
    b.display_order as bin_display_order,
    b.name as bin_name,
    g.name as game_name
  FROM lottery_packs p
  LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
  LEFT JOIN lottery_games g ON p.game_id = g.game_id
  WHERE p.status IN ('ACTIVE', 'RETURNED', 'DEPLETED')
  ORDER BY b.display_order
`).all();
allPacks.forEach(p => {
  const binNum = p.bin_display_order !== null ? p.bin_display_order + 1 : 'NULL';
  console.log(`[${p.status}] ${p.game_name} (Pack ${p.pack_number}): Bin ${binNum}`);
});

// Check if there's historical bin info or activation bin
console.log('\n=== WHAT BIN WAS EACH PACK ACTIVATED IN? ===');
const packDetails = db.prepare(`
  SELECT
    p.pack_number,
    p.status,
    p.current_bin_id,
    p.activated_at,
    p.returned_at,
    p.depleted_at,
    g.name as game_name,
    b.display_order as current_bin_order
  FROM lottery_packs p
  LEFT JOIN lottery_games g ON p.game_id = g.game_id
  LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
  WHERE p.status IN ('ACTIVE', 'RETURNED', 'DEPLETED')
`).all();

packDetails.forEach(p => {
  console.log(`\n${p.game_name} (Pack ${p.pack_number}) - ${p.status}:`);
  console.log(`  current_bin_id: ${p.current_bin_id}`);
  console.log(`  Current bin #: ${p.current_bin_order !== null ? p.current_bin_order + 1 : 'NULL'}`);
  console.log(`  activated_at: ${p.activated_at}`);
  if (p.returned_at) console.log(`  returned_at: ${p.returned_at}`);
  if (p.depleted_at) console.log(`  depleted_at: ${p.depleted_at}`);
});

// Check if packs were ever in a different bin (via lottery_day_packs maybe?)
console.log('\n=== CHECK lottery_day_packs FOR BIN HISTORY ===');
const dayPacksBins = db.prepare(`
  SELECT
    ldp.pack_id,
    ldp.bin_id as day_bin_id,
    b.display_order as day_bin_order,
    lbd.business_date,
    p.pack_number,
    p.current_bin_id,
    cb.display_order as current_bin_order
  FROM lottery_day_packs ldp
  JOIN lottery_packs p ON ldp.pack_id = p.pack_id
  JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
  LEFT JOIN lottery_bins b ON ldp.bin_id = b.bin_id
  LEFT JOIN lottery_bins cb ON p.current_bin_id = cb.bin_id
  WHERE p.status IN ('ACTIVE', 'RETURNED', 'DEPLETED')
`).all();

if (dayPacksBins.length === 0) {
  console.log('No lottery_day_packs records found for these packs');
} else {
  dayPacksBins.forEach(r => {
    console.log(`Pack ${r.pack_number} on ${r.business_date}: day_bin=${r.day_bin_order !== null ? r.day_bin_order + 1 : 'NULL'}, current_bin=${r.current_bin_order !== null ? r.current_bin_order + 1 : 'NULL'}`);
  });
}

// Check sync_queue for recent pack operations
console.log('\n=== RECENT SYNC QUEUE (PACK) ===');
try {
  const syncQueue = db.prepare(`
    SELECT entity_id, operation, status, payload, created_at
    FROM sync_queue
    WHERE entity_type = 'pack'
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  syncQueue.forEach(s => {
    const payload = JSON.parse(s.payload || '{}');
    console.log(`[${s.status}] ${s.operation} at ${s.created_at}`);
    console.log(`  pack_number: ${payload.pack_number}, bin_id: ${payload.bin_id}`);
  });
} catch (e) {
  console.log('Could not read sync_queue:', e.message);
}

db.close();
