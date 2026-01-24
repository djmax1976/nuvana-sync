const { app, safeStorage } = require('electron');

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  const Database = require('better-sqlite3-multiple-ciphers');

  const store = new Store({ name: 'nuvana' });
  const storedData = store.get('encryptedDbKey');
  const encryptedBuffer = Buffer.from(storedData);
  const key = safeStorage.decryptString(encryptedBuffer);

  const dbPath = app.getPath('userData') + '/nuvana.db';
  const db = new Database(dbPath);

  db.pragma(`key = '${key}'`);
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`kdf_iter = 256000`);

  // Query all shifts with detailed info
  console.log('\n=== ALL SHIFTS ===');
  const shifts = db.prepare(`
    SELECT shift_id, business_date, start_time, end_time, status,
           external_register_id, shift_number, created_at
    FROM shifts
    ORDER BY business_date DESC, shift_number
  `).all();

  shifts.forEach(s => {
    console.log(`BD: ${s.business_date} | Start: ${s.start_time} | End: ${s.end_time} | Status: ${s.status} | RegID: ${s.external_register_id} | Created: ${s.created_at}`);
  });
  console.log(`\nTotal shifts: ${shifts.length}`);

  // Check processed files
  console.log('\n=== MSM PROCESSED FILES ===');
  const msmFiles = db.prepare(`
    SELECT file_name, record_count, processed_at, status
    FROM processed_files
    WHERE file_type = 'MiscellaneousSummaryMovement'
    ORDER BY processed_at DESC
  `).all();

  msmFiles.forEach(f => {
    console.log(`${f.file_name} | Records: ${f.record_count} | Status: ${f.status}`);
  });

  db.close();
  app.quit();
});
