const { app } = require('electron');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  const { safeStorage } = require('electron');
  const Database = require('better-sqlite3-multiple-ciphers');

  const store = new Store({ name: 'nuvana-config' });
  const storedData = store.get('encryptedDbKey');
  const encryptedBuffer = Buffer.from(storedData);
  const key = safeStorage.decryptString(encryptedBuffer);

  const dbPath = app.getPath('userData') + '\\nuvana.db';
  const db = new Database(dbPath);

  db.pragma(`key = '${key}'`);
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`kdf_iter = 256000`);

  console.log('\n=== SHIFTS FOR JAN 9, 2026 ===');
  const shifts = db.prepare(`
    SELECT * FROM shifts
    WHERE business_date = '2026-01-09'
  `).all();
  console.log(JSON.stringify(shifts, null, 2));

  if (shifts.length > 0) {
    const shiftId = shifts[0].shift_id;

    console.log('\n=== SHIFT SUMMARIES FOR JAN 9 ===');
    const summaries = db.prepare(`
      SELECT * FROM shift_summaries
      WHERE shift_id = ?
    `).all(shiftId);
    console.log(JSON.stringify(summaries, null, 2));

    if (summaries.length > 0) {
      const summaryId = summaries[0].shift_summary_id;

      console.log('\n=== SHIFT FUEL SUMMARIES ===');
      const fuelSummaries = db.prepare(`
        SELECT * FROM shift_fuel_summaries
        WHERE shift_summary_id = ?
      `).all(summaryId);
      console.log(JSON.stringify(fuelSummaries, null, 2));

      console.log('\n=== FUEL TOTALS (Aggregated) ===');
      const fuelTotals = db.prepare(`
        SELECT
          COALESCE(fuel_grade_id, grade_id) as grade_id,
          grade_name,
          SUM(sales_volume) as total_volume,
          SUM(sales_amount) as total_sales
        FROM shift_fuel_summaries
        WHERE shift_summary_id = ?
        GROUP BY COALESCE(fuel_grade_id, grade_id), grade_name
      `).all(summaryId);
      console.log(JSON.stringify(fuelTotals, null, 2));

      console.log('\n=== SHIFT TENDER SUMMARIES ===');
      const tenderSummaries = db.prepare(`
        SELECT * FROM shift_tender_summaries
        WHERE shift_summary_id = ?
      `).all(summaryId);
      console.log(JSON.stringify(tenderSummaries, null, 2));
    }
  }

  db.close();
  process.exit(0);
});
