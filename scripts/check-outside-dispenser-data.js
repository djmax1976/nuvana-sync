const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const os = require('os');

// Try to find the database
const possiblePaths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana-sync', 'nuvana.db'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'nuvana', 'nuvana.db'),
  path.join(process.cwd(), 'nuvana.db'),
];

let db = null;
let dbPath = null;

for (const p of possiblePaths) {
  try {
    if (require('fs').existsSync(p)) {
      dbPath = p;
      console.log('Found database at:', p);
      break;
    }
  } catch (e) {}
}

if (!dbPath) {
  console.log('Database not found in common locations');
  console.log('Checked:', possiblePaths);
  process.exit(1);
}

try {
  db = new Database(dbPath, { readonly: true });
  
  // Check if table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='msm_outside_dispenser_records'
  `).get();
  
  if (!tableExists) {
    console.log('\n❌ Table msm_outside_dispenser_records does NOT exist!');
    console.log('The v014 migration may not have been applied.');
    process.exit(1);
  }
  
  console.log('\n✅ Table msm_outside_dispenser_records exists');
  
  // Count records
  const count = db.prepare('SELECT COUNT(*) as cnt FROM msm_outside_dispenser_records').get();
  console.log(`\nTotal records in msm_outside_dispenser_records: ${count.cnt}`);
  
  if (count.cnt === 0) {
    console.log('\n⚠️  No outside dispenser records found!');
    console.log('This means MSM Period 98 files were either:');
    console.log('  1. Never parsed, OR');
    console.log('  2. Parsed before the v014 migration was applied');
    console.log('\nYou need to REPARSE the MSM files to populate this data.');
  } else {
    // Show sample data
    console.log('\nSample outside dispenser records:');
    const samples = db.prepare(`
      SELECT * FROM msm_outside_dispenser_records 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all();
    console.table(samples);
    
    // Show totals by shift
    console.log('\nOutside fuel totals by shift:');
    const byShift = db.prepare(`
      SELECT 
        shift_id,
        business_date,
        SUM(amount) as total_amount,
        SUM(transaction_count) as total_count,
        COUNT(*) as record_count
      FROM msm_outside_dispenser_records
      GROUP BY shift_id, business_date
      ORDER BY business_date DESC
      LIMIT 10
    `).all();
    console.table(byShift);
  }
  
  // Also check shift_fuel_summaries
  console.log('\n--- Checking shift_fuel_summaries ---');
  const fuelCount = db.prepare('SELECT COUNT(*) as cnt FROM shift_fuel_summaries').get();
  console.log(`Total records in shift_fuel_summaries: ${fuelCount.cnt}`);
  
  const msmFuelCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM shift_fuel_summaries WHERE fuel_source = 'MSM'
  `).get();
  console.log(`MSM-sourced fuel records: ${msmFuelCount.cnt}`);
  
  if (msmFuelCount.cnt > 0) {
    const sampleFuel = db.prepare(`
      SELECT shift_summary_id, grade_id, inside_volume, inside_amount, outside_volume, outside_amount, fuel_source
      FROM shift_fuel_summaries 
      WHERE fuel_source = 'MSM'
      ORDER BY created_at DESC
      LIMIT 5
    `).all();
    console.log('\nSample MSM fuel summaries:');
    console.table(sampleFuel);
  }

} catch (e) {
  console.error('Error:', e.message);
} finally {
  if (db) db.close();
}
