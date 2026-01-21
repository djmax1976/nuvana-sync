const { app, safeStorage } = require('electron');

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  const Database = require('better-sqlite3-multiple-ciphers');

  const store = new Store({ name: 'nuvana' });
  const storedData = store.get('encryptedDbKey');
  const encryptedBuffer = Buffer.from(storedData);
  const key = safeStorage.decryptString(encryptedBuffer);

  const dbPath = app.getPath('userData') + '/nuvana.db';
  console.log('Database path:', dbPath);

  const db = new Database(dbPath);

  db.pragma(`key = '${key}'`);
  db.pragma(`cipher = 'sqlcipher'`);
  db.pragma(`kdf_iter = 256000`);

  // Check schema_migrations table
  console.log('\n=== APPLIED MIGRATIONS ===');
  try {
    const migrations = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 10").all();
    migrations.forEach(m => {
      console.log(`  v${String(m.version).padStart(3, '0')}: ${m.name}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check lottery_bins schema
  console.log('\n=== LOTTERY_BINS SCHEMA ===');
  try {
    const schema = db.prepare("PRAGMA table_info(lottery_bins)").all();
    schema.forEach(col => {
      console.log(`  ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check if 'name' column exists
  console.log('\n=== CHECKING FOR NAME COLUMN ===');
  try {
    const schema = db.prepare("PRAGMA table_info(lottery_bins)").all();
    const hasName = schema.some(col => col.name === 'name');
    const hasLabel = schema.some(col => col.name === 'label');
    console.log(`  Has 'name' column: ${hasName}`);
    console.log(`  Has 'label' column: ${hasLabel}`);
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Sample data from lottery_bins
  console.log('\n=== SAMPLE LOTTERY_BINS DATA ===');
  try {
    const bins = db.prepare("SELECT * FROM lottery_bins LIMIT 3").all();
    bins.forEach(bin => {
      console.log(`  Bin: ${JSON.stringify(bin, null, 2)}`);
    });
  } catch(e) {
    console.log('Error:', e.message);
  }

  db.close();
  app.quit();
});
