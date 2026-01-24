/**
 * Check fuel data in database
 */
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), '.nuvana-sync', 'nuvana.db');
console.log('Database path:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  // Check fuel_grade_movements
  const fgmCount = db.prepare('SELECT COUNT(*) as count FROM fuel_grade_movements').get() as {
    count: number;
  };
  console.log('\n=== fuel_grade_movements ===');
  console.log('Total records:', fgmCount.count);

  const fgmWithShift = db
    .prepare('SELECT COUNT(*) as count FROM fuel_grade_movements WHERE shift_id IS NOT NULL')
    .get() as { count: number };
  console.log('Records with shift_id:', fgmWithShift.count);

  // Sample records
  const fgmSample = db
    .prepare(
      'SELECT id, business_date, shift_id, grade_id, grade_name, volume_sold, amount_sold FROM fuel_grade_movements LIMIT 5'
    )
    .all();
  console.log('Sample records:', JSON.stringify(fgmSample, null, 2));

  // Check shifts
  const shiftCount = db.prepare('SELECT COUNT(*) as count FROM shifts').get() as { count: number };
  console.log('\n=== shifts ===');
  console.log('Total shifts:', shiftCount.count);

  // Check if any shifts have fuel data
  const shiftsWithFuel = db
    .prepare(
      `
    SELECT s.shift_id, s.business_date, s.shift_number, COUNT(f.id) as fuel_records
    FROM shifts s
    LEFT JOIN fuel_grade_movements f ON s.shift_id = f.shift_id
    GROUP BY s.shift_id
    HAVING fuel_records > 0
    LIMIT 5
  `
    )
    .all();
  console.log('Shifts with fuel data:', JSON.stringify(shiftsWithFuel, null, 2));

  db.close();
} catch (err) {
  console.error('Error:', err);
}
