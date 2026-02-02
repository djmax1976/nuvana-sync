/**
 * Fix depleted pack sales amount
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db');
const db = new Database(dbPath);

// Check packs with any sales amount
const packsWithSales = db
  .prepare(
    `
  SELECT 
    p.pack_id,
    p.pack_number,
    p.status,
    p.opening_serial,
    p.closing_serial,
    p.serial_end,
    p.tickets_sold_count,
    p.sales_amount,
    p.depleted_at,
    g.name as game_name,
    g.price as game_price
  FROM lottery_packs p
  LEFT JOIN lottery_games g ON p.game_id = g.game_id
  WHERE p.sales_amount > 0 OR p.tickets_sold_count > 0
  ORDER BY p.updated_at DESC
  LIMIT 20
`
  )
  .all();

console.log('Packs with sales:');
console.log(JSON.stringify(packsWithSales, null, 2));

// Also check status distribution
const statusCounts = db
  .prepare(
    `
  SELECT status, COUNT(*) as count 
  FROM lottery_packs 
  GROUP BY status
`
  )
  .all();

console.log('\nStatus distribution:');
console.log(JSON.stringify(statusCounts, null, 2));

db.close();
