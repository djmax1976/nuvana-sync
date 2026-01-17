/**
 * Direct database check script - run via electron to access better-sqlite3
 */
import { app } from 'electron';
import path from 'path';

// Initialize database path before importing DALs
process.env.NUVANA_DATA_PATH = path.join(app.getPath('userData'));

// Dynamically import after setting path
async function main() {
  const { databaseService } = await import('../src/main/services/database.service');

  // Initialize database
  databaseService.initialize();

  const db = databaseService.getDatabase();

  console.log('\n=== DATABASE CHECK ===\n');

  // Check processed files
  const processedCount = db.prepare('SELECT COUNT(*) as count FROM processed_files').get() as {
    count: number;
  };
  console.log('Processed files:', processedCount.count);

  // Check shifts
  const shiftCount = db.prepare('SELECT COUNT(*) as count FROM shifts').get() as { count: number };
  console.log('Shifts:', shiftCount.count);

  // Sample shifts
  const shifts = db
    .prepare(
      `
    SELECT shift_id, register_id, cashier_id, business_date, status
    FROM shifts
    ORDER BY created_at DESC
    LIMIT 5
  `
    )
    .all();
  console.log('\nRecent shifts:');
  shifts.forEach((s: any) => {
    console.log(
      `  ${s.business_date} | reg: ${s.register_id || 'null'} | cashier: ${s.cashier_id || 'null'} | ${s.status}`
    );
  });

  // Sample processed files
  const files = db
    .prepare(
      `
    SELECT file_name, record_count, status, document_type
    FROM processed_files
    ORDER BY created_at DESC
    LIMIT 10
  `
    )
    .all();
  console.log('\nRecent processed files:');
  files.forEach((f: any) => {
    console.log(
      `  ${f.file_name} | records: ${f.record_count} | ${f.status} | type: ${f.document_type}`
    );
  });

  // Check stores
  const stores = db.prepare('SELECT store_id, name FROM stores').all();
  console.log('\nStores:', stores);

  // Check pos_terminal_mappings (REGISTERS)
  const terminalCount = db
    .prepare(
      'SELECT terminal_type, COUNT(*) as count FROM pos_terminal_mappings GROUP BY terminal_type'
    )
    .all();
  console.log('\nTerminal mappings by type:', terminalCount);

  const registers = db
    .prepare(
      `SELECT id, external_register_id, terminal_type, description, active
       FROM pos_terminal_mappings
       WHERE terminal_type = 'REGISTER'
       ORDER BY external_register_id ASC
       LIMIT 10`
    )
    .all();
  console.log('\nRegisters:');
  registers.forEach((r: any) => {
    console.log(
      `  ID: ${r.id} | ext_reg: ${r.external_register_id} | desc: ${r.description || 'null'} | active: ${r.active}`
    );
  });

  databaseService.close();
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((err) => {
    console.error('Error:', err);
    app.quit();
  });
