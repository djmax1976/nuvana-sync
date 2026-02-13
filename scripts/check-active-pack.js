/**
 * Check active pack calculations
 */
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const db = new Database(path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db'), { readonly: true });

const packNumber = process.argv[2] || '0019642';

console.log('=== Pack', packNumber, 'Details ===');
const pack = db.prepare(`
  SELECT pack_id, pack_number, store_id, status, opening_serial, closing_serial, game_id
  FROM lottery_packs
  WHERE pack_number = ?
`).get(packNumber);

if (!pack) {
  console.log('Pack not found');
  process.exit(1);
}
console.log(pack);

console.log('\n=== lottery_day_packs for this pack ===');
const dayPacks = db.prepare(`
  SELECT
    ldp.starting_serial,
    ldp.ending_serial,
    ldp.tickets_sold,
    lbd.business_date,
    lbd.status as day_status,
    lbd.closed_at
  FROM lottery_day_packs ldp
  JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
  WHERE ldp.pack_id = ?
  ORDER BY lbd.closed_at DESC
`).all(pack.pack_id);
console.log(dayPacks.length ? dayPacks : 'No day_pack records');

console.log('\n=== Subquery result (prev_ending_serial) ===');
const prevEnding = db.prepare(`
  SELECT ldp.ending_serial
  FROM lottery_day_packs ldp
  JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
  WHERE ldp.pack_id = ?
    AND lbd.status = 'CLOSED'
  ORDER BY lbd.closed_at DESC
  LIMIT 1
`).get(pack.pack_id);
console.log('prev_ending_serial:', prevEnding?.ending_serial ?? 'NULL (will fallback to opening_serial)');

// Get game info
const game = db.prepare('SELECT tickets_per_pack, price FROM lottery_games WHERE game_id = ?').get(pack.game_id);
console.log('\nGame tickets_per_pack:', game?.tickets_per_pack);

const currentPos = prevEnding?.ending_serial ?? pack.opening_serial;
const openingNum = parseInt(pack.opening_serial, 10);
const lastTicket = openingNum + (game?.tickets_per_pack || 60) - 1;
const remaining = (lastTicket + 1) - parseInt(currentPos, 10);

console.log('\n=== Expected Calculation ===');
console.log('opening_serial:', pack.opening_serial);
console.log('prev_ending_serial:', prevEnding?.ending_serial ?? 'NULL');
console.log('currentPosition used:', currentPos);
console.log('lastTicketNum:', lastTicket);
console.log('Formula: (' + lastTicket + ' + 1) - ' + parseInt(currentPos, 10) + ' = ' + remaining + ' tickets remaining');

db.close();
