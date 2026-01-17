import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath, { readonly: true });

console.log('\n=== PROCESSED FILES ===');
const count = db.prepare('SELECT COUNT(*) as count FROM processed_files').get() as {
  count: number;
};
console.log('Processed files count:', count.count);

const files = db
  .prepare(
    'SELECT file_name, record_count, status FROM processed_files ORDER BY created_at DESC LIMIT 10'
  )
  .all();
console.log('Recent files:', JSON.stringify(files, null, 2));

console.log('\n=== SHIFTS ===');
const shiftCount = db.prepare('SELECT COUNT(*) as count FROM shifts').get() as { count: number };
console.log('Shifts count:', shiftCount.count);

const shifts = db
  .prepare(
    'SELECT shift_id, register_id, cashier_id, business_date, status FROM shifts ORDER BY created_at DESC LIMIT 10'
  )
  .all();
console.log('Recent shifts:', JSON.stringify(shifts, null, 2));

console.log('\n=== STORES ===');
const stores = db.prepare('SELECT store_id, name FROM stores').all();
console.log('Stores:', JSON.stringify(stores, null, 2));

db.close();
