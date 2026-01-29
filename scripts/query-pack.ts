import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath, { readonly: true });

// First find the game with code 1843
console.log('\n===== GAME INFO (code 1843) =====');
const game = db.prepare('SELECT * FROM lottery_games WHERE game_code = ?').get('1843');
if (game) {
  console.log(JSON.stringify(game, null, 2));
} else {
  console.log('Game with code 1843 not found');
}

// Now search for the pack
console.log('\n===== SEARCHING FOR PACK 0339316 =====');

// Search with full pack number
const packQuery = db.prepare(`
  SELECT lp.*,
         lg.game_code, lg.name as game_name, lg.price as game_price, lg.tickets_per_pack,
         lb.name as bin_name, lb.display_order as bin_display_order,
         u_recv.name as received_by_name,
         u_act.name as activated_by_name,
         u_dep.name as depleted_by_name,
         u_ret.name as returned_by_name
  FROM lottery_packs lp
  LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
  LEFT JOIN lottery_bins lb ON lp.current_bin_id = lb.bin_id
  LEFT JOIN users u_recv ON lp.received_by = u_recv.user_id
  LEFT JOIN users u_act ON lp.activated_by = u_act.user_id
  LEFT JOIN users u_dep ON lp.depleted_by = u_dep.user_id
  LEFT JOIN users u_ret ON lp.returned_by = u_ret.user_id
  WHERE lp.pack_number LIKE ?
  ORDER BY lp.updated_at DESC
`);

const packs = packQuery.all('%339316%');

if (packs.length > 0) {
  console.log(`Found ${packs.length} pack(s):\n`);
  for (const pack of packs) {
    console.log('='.repeat(80));
    console.log('FULL PACK RECORD:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(pack, null, 2));

    // Also show formatted key details
    console.log('\n--- KEY ACTIVATION DETAILS ---');
    console.log(`Pack Number: ${(pack as any).pack_number}`);
    console.log(`Game Code: ${(pack as any).game_code}`);
    console.log(`Game Name: ${(pack as any).game_name}`);
    console.log(`Status: ${(pack as any).status}`);
    console.log(`Bin: ${(pack as any).bin_name || 'N/A'}`);
    console.log('');
    console.log(`Received At: ${(pack as any).received_at || 'N/A'}`);
    console.log(
      `Received By: ${(pack as any).received_by_name || (pack as any).received_by || 'N/A'}`
    );
    console.log('');
    console.log(`Activated At: ${(pack as any).activated_at || 'N/A'}`);
    console.log(
      `Activated By: ${(pack as any).activated_by_name || (pack as any).activated_by || 'N/A'}`
    );
    console.log(`Activated Shift ID: ${(pack as any).activated_shift_id || 'N/A'}`);
    console.log(`Opening Serial: ${(pack as any).opening_serial || 'N/A'}`);
    console.log('');
    console.log(`Depleted At: ${(pack as any).depleted_at || 'N/A'}`);
    console.log(
      `Depleted By: ${(pack as any).depleted_by_name || (pack as any).depleted_by || 'N/A'}`
    );
    console.log('');
    console.log(`Created At: ${(pack as any).created_at}`);
    console.log(`Updated At: ${(pack as any).updated_at}`);
    console.log(`Synced At: ${(pack as any).synced_at || 'N/A'}`);
  }
} else {
  console.log('No packs found with pack number containing 339316');

  // Let's also check what game codes exist
  console.log('\n===== ALL DISTINCT GAME CODES =====');
  const gameCodes = db
    .prepare('SELECT DISTINCT game_code FROM lottery_games ORDER BY game_code')
    .all();
  console.log('Available game codes:', gameCodes.map((g: any) => g.game_code).join(', '));

  // Check recently activated packs
  console.log('\n===== RECENTLY ACTIVATED PACKS =====');
  const recentPacks = db
    .prepare(
      `
    SELECT lp.pack_number, lg.game_code, lp.status, lp.activated_at
    FROM lottery_packs lp
    LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
    WHERE lp.activated_at IS NOT NULL
    ORDER BY lp.activated_at DESC
    LIMIT 10
  `
    )
    .all();
  console.log(JSON.stringify(recentPacks, null, 2));
}

db.close();
