/**
 * Check Jan 9 shift fuel data - run via electron to access database
 */
import { app } from 'electron';
import path from 'path';

// Initialize database path before importing DALs
process.env.NUVANA_DATA_PATH = path.join(app.getPath('userData'));

async function main() {
  const { databaseService } = await import('../src/main/services/database.service');

  // Initialize database
  databaseService.initialize();
  const db = databaseService.getDatabase();

  console.log('\n========================================');
  console.log('JAN 9, 2026 SHIFT DATA CHECK');
  console.log('========================================\n');

  // Check shifts for Jan 9
  const shifts = db
    .prepare(
      `
    SELECT * FROM shifts
    WHERE business_date = '2026-01-09'
  `
    )
    .all();

  console.log('SHIFTS FOR JAN 9, 2026:');
  console.log(JSON.stringify(shifts, null, 2));

  if (shifts.length === 0) {
    console.log('\nNO SHIFTS FOUND FOR JAN 9!');
    console.log('\nChecking all shifts...');
    const allShifts = db
      .prepare(
        `
      SELECT business_date, shift_id, status, start_time, end_time
      FROM shifts
      ORDER BY business_date DESC
      LIMIT 10
    `
      )
      .all();
    console.log(JSON.stringify(allShifts, null, 2));
  } else {
    const shiftId = (shifts[0] as any).shift_id;
    console.log(`\nShift ID: ${shiftId}`);

    // Check shift_summaries
    console.log('\n--- SHIFT SUMMARIES ---');
    const summaries = db
      .prepare(
        `
      SELECT * FROM shift_summaries WHERE shift_id = ?
    `
      )
      .all(shiftId);
    console.log(JSON.stringify(summaries, null, 2));

    if (summaries.length > 0) {
      const summaryId = (summaries[0] as any).shift_summary_id;
      console.log(`\nShift Summary ID: ${summaryId}`);

      // Check shift_fuel_summaries
      console.log('\n--- SHIFT FUEL SUMMARIES (Individual Records) ---');
      const fuelSummaries = db
        .prepare(
          `
        SELECT * FROM shift_fuel_summaries WHERE shift_summary_id = ?
      `
        )
        .all(summaryId);
      console.log(JSON.stringify(fuelSummaries, null, 2));

      // Check aggregated totals
      console.log('\n--- FUEL TOTALS BY GRADE (Aggregated) ---');
      const fuelByGrade = db
        .prepare(
          `
        SELECT
          COALESCE(fuel_grade_id, grade_id) as grade_id,
          grade_name,
          SUM(sales_volume) as total_volume,
          SUM(sales_amount) as total_sales,
          SUM(discount_amount) as total_discount
        FROM shift_fuel_summaries
        WHERE shift_summary_id = ?
        GROUP BY COALESCE(fuel_grade_id, grade_id), grade_name
        ORDER BY total_sales DESC
      `
        )
        .all(summaryId);
      console.log(JSON.stringify(fuelByGrade, null, 2));

      // Grand total
      console.log('\n--- GRAND FUEL TOTALS ---');
      const grandTotal = db
        .prepare(
          `
        SELECT
          COALESCE(SUM(sales_volume), 0) as total_volume,
          COALESCE(SUM(sales_amount), 0) as total_sales,
          COALESCE(SUM(discount_amount), 0) as total_discount
        FROM shift_fuel_summaries
        WHERE shift_summary_id = ?
      `
        )
        .get(summaryId);
      console.log(JSON.stringify(grandTotal, null, 2));

      // Tender summaries
      console.log('\n--- SHIFT TENDER SUMMARIES ---');
      const tenderSummaries = db
        .prepare(
          `
        SELECT * FROM shift_tender_summaries WHERE shift_summary_id = ?
      `
        )
        .all(summaryId);
      console.log(JSON.stringify(tenderSummaries, null, 2));
    }
  }

  // Also check processed files for Jan 9
  console.log('\n--- PROCESSED FILES FOR JAN 9 ---');
  const processedFiles = db
    .prepare(
      `
    SELECT file_name, document_type, record_count, status, created_at
    FROM processed_files
    WHERE file_name LIKE '%0109%' OR file_name LIKE '%01-09%' OR file_name LIKE '%Jan%9%'
    ORDER BY created_at DESC
    LIMIT 20
  `
    )
    .all();
  console.log(JSON.stringify(processedFiles, null, 2));

  console.log('\n========================================');
  console.log('EXPECTED VALUES FROM PDF:');
  console.log('Total Fuel Volume: 511.900 gallons');
  console.log('Total Fuel Sales: $1,472.48');
  console.log('Fuel Discount: -$0.48');
  console.log('Net Total Sales: $1,472.00');
  console.log('Cash: $808.04');
  console.log('Crind CREDIT: $648.96 (20 txns)');
  console.log('Crind DEBIT: $15.00 (1 txn)');
  console.log('========================================\n');

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
