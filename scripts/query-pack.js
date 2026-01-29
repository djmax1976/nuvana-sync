const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Find the pack with full details
const pack = db.prepare(`
  SELECT lp.*,
         lg.game_code, lg.name as game_name, lg.price as game_price, lg.tickets_per_pack,
         lb.name as bin_name, lb.display_order as bin_display_order,
         u_recv.name as received_by_name, u_recv.role as received_by_role,
         u_act.name as activated_by_name, u_act.role as activated_by_role,
         u_dep.name as depleted_by_name, u_dep.role as depleted_by_role,
         u_ret.name as returned_by_name, u_ret.role as returned_by_role,
         s_act.business_date as activated_shift_business_date,
         s_dep.business_date as depleted_shift_business_date
  FROM lottery_packs lp
  LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
  LEFT JOIN lottery_bins lb ON lp.current_bin_id = lb.bin_id
  LEFT JOIN users u_recv ON lp.received_by = u_recv.user_id
  LEFT JOIN users u_act ON lp.activated_by = u_act.user_id
  LEFT JOIN users u_dep ON lp.depleted_by = u_dep.user_id
  LEFT JOIN users u_ret ON lp.returned_by = u_ret.user_id
  LEFT JOIN shifts s_act ON lp.activated_shift_id = s_act.shift_id
  LEFT JOIN shifts s_dep ON lp.depleted_shift_id = s_dep.shift_id
  WHERE lp.pack_number = ?
  AND lg.game_code = ?
`).get('0339316', '1843');

console.log('=== COMPLETE PACK DETAILS ===');
console.log('Game: 1843 | Pack Number: 0339316');
console.log('========================================');

if (pack) {
  // Format the output nicely
  console.log('\n--- PACK IDENTIFICATION ---');
  console.log('Pack ID:', pack.pack_id);
  console.log('Cloud Pack ID:', pack.cloud_pack_id);
  console.log('Store ID:', pack.store_id);
  console.log('Game ID:', pack.game_id);
  console.log('Game Code:', pack.game_code);
  console.log('Game Name:', pack.game_name);
  console.log('Pack Number:', pack.pack_number);
  console.log('Ticket Price:', '$' + pack.game_price);
  console.log('Tickets Per Pack:', pack.tickets_per_pack);

  console.log('\n--- CURRENT STATUS ---');
  console.log('Status:', pack.status);
  console.log('Current Bin ID:', pack.current_bin_id);
  console.log('Bin Name:', pack.bin_name);
  console.log('Bin Display Order:', pack.bin_display_order);

  console.log('\n--- SERIAL NUMBERS ---');
  console.log('Serial Start:', pack.serial_start);
  console.log('Serial End:', pack.serial_end);
  console.log('Opening Serial:', pack.opening_serial);
  console.log('Closing Serial:', pack.closing_serial);
  console.log('Last Sold Serial:', pack.last_sold_serial);

  console.log('\n--- SALES INFO ---');
  console.log('Tickets Sold Count:', pack.tickets_sold_count);
  console.log('Sales Amount:', '$' + pack.sales_amount);
  console.log('Last Sold At:', pack.last_sold_at);

  console.log('\n--- RECEIVED INFO ---');
  console.log('Received At:', pack.received_at);
  console.log('Received By (ID):', pack.received_by);
  console.log('Received By (Name):', pack.received_by_name);
  console.log('Received By (Role):', pack.received_by_role);

  console.log('\n--- ACTIVATION INFO ---');
  console.log('Activated At:', pack.activated_at);
  console.log('Activated By (ID):', pack.activated_by);
  console.log('Activated By (Name):', pack.activated_by_name);
  console.log('Activated By (Role):', pack.activated_by_role);
  console.log('Activated Shift ID:', pack.activated_shift_id);
  console.log('Activated Shift Business Date:', pack.activated_shift_business_date);

  console.log('\n--- DEPLETION INFO ---');
  console.log('Depleted At:', pack.depleted_at);
  console.log('Depleted By (ID):', pack.depleted_by);
  console.log('Depleted By (Name):', pack.depleted_by_name);
  console.log('Depleted By (Role):', pack.depleted_by_role);
  console.log('Depleted Shift ID:', pack.depleted_shift_id);
  console.log('Depleted Shift Business Date:', pack.depleted_shift_business_date);
  console.log('Depletion Reason:', pack.depletion_reason);

  console.log('\n--- RETURN INFO ---');
  console.log('Returned At:', pack.returned_at);
  console.log('Returned By (ID):', pack.returned_by);
  console.log('Returned By (Name):', pack.returned_by_name);
  console.log('Return Reason:', pack.return_reason);
  console.log('Return Notes:', pack.return_notes);

  console.log('\n--- APPROVAL OVERRIDES ---');
  console.log('Serial Override Approved By:', pack.serial_override_approved_by);
  console.log('Serial Override Reason:', pack.serial_override_reason);
  console.log('Serial Override Approved At:', pack.serial_override_approved_at);
  console.log('Mark Sold Approved By:', pack.mark_sold_approved_by);
  console.log('Mark Sold Reason:', pack.mark_sold_reason);
  console.log('Mark Sold Approved At:', pack.mark_sold_approved_at);

  console.log('\n--- TIMESTAMPS ---');
  console.log('Created At:', pack.created_at);
  console.log('Updated At:', pack.updated_at);
  console.log('Synced At:', pack.synced_at);

  console.log('\n--- RAW JSON ---');
  console.log(JSON.stringify(pack, null, 2));
} else {
  console.log('Pack NOT FOUND with game code 1843 and pack number 0339316');

  // Search broader
  const packs = db.prepare(`
    SELECT lp.pack_number, lp.status, lp.activated_at, lg.game_code, lg.name
    FROM lottery_packs lp
    LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
    WHERE lp.pack_number LIKE '%339316%'
    ORDER BY lp.activated_at DESC
  `).all();

  if (packs.length > 0) {
    console.log('\nPartial matches found:');
    console.log(JSON.stringify(packs, null, 2));
  }
}

db.close();
