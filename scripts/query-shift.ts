import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
const db = new Database(dbPath, { readonly: true });

// Get shift details
console.log('===== SHIFT DETAILS (b85bd482-0f60-4dcc-a338-e9a93883b140) =====');
const shift = db
  .prepare(
    `
  SELECT s.*, u.name as cashier_name
  FROM shifts s
  LEFT JOIN users u ON s.cashier_id = u.user_id
  WHERE s.shift_id = ?
`
  )
  .get('b85bd482-0f60-4dcc-a338-e9a93883b140');
console.log(JSON.stringify(shift, null, 2));

// Get the user who activated
console.log('\n===== ACTIVATED BY USER (2458b977-72ca-4d8d-b30a-043c63c01a33) =====');
const activatedByUser = db
  .prepare(
    'SELECT user_id, store_id, role, name, active, last_login_at, cloud_user_id, synced_at, created_at, updated_at FROM users WHERE user_id = ?'
  )
  .get('2458b977-72ca-4d8d-b30a-043c63c01a33');
console.log(JSON.stringify(activatedByUser, null, 2));

// Get the user who received the pack
console.log('\n===== RECEIVED BY USER (550fbf0e-0605-4e40-9313-bfbc202c7427) =====');
const receivedByUser = db
  .prepare(
    'SELECT user_id, store_id, role, name, active, last_login_at, cloud_user_id, synced_at, created_at, updated_at FROM users WHERE user_id = ?'
  )
  .get('550fbf0e-0605-4e40-9313-bfbc202c7427');
console.log(JSON.stringify(receivedByUser, null, 2));

// Get bin details
console.log('\n===== BIN DETAILS (c04df937-04d8-4f4e-ac22-3004f135e774) =====');
const bin = db
  .prepare('SELECT * FROM lottery_bins WHERE bin_id = ?')
  .get('c04df937-04d8-4f4e-ac22-3004f135e774');
console.log(JSON.stringify(bin, null, 2));

db.close();
