/**
 * Check Migration Status Script
 *
 * Run with: npx ts-node scripts/check-migrations.ts
 * Or with explicit path: npx ts-node scripts/check-migrations.ts <path-to-nuvana.db>
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Try multiple possible database locations
const possiblePaths = [
  // Windows Electron userData
  path.join(process.env.APPDATA || '', 'nuvana', 'nuvana.db'),
  path.join(process.env.APPDATA || '', 'Nuvana', 'nuvana.db'),
  // Linux/macOS Electron userData
  path.join(os.homedir(), '.config', 'nuvana', 'nuvana.db'),
  path.join(os.homedir(), '.config', 'Nuvana', 'nuvana.db'),
  // macOS
  path.join(os.homedir(), 'Library', 'Application Support', 'nuvana', 'nuvana.db'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Nuvana', 'nuvana.db'),
  // Legacy paths
  path.join(os.homedir(), '.nuvana', 'nuvana.db'),
];

// Allow override via command line argument
let dbPath = process.argv[2] || '';

if (!dbPath || !fs.existsSync(dbPath)) {
  // Find the first existing database
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      dbPath = p;
      break;
    }
  }
}

if (!dbPath || !fs.existsSync(dbPath)) {
  console.log('Could not find nuvana.db in any of these locations:');
  possiblePaths.forEach((p) => console.log(`  - ${p}`));
  console.log('');
  console.log('Please provide the database path as an argument:');
  console.log('  npx ts-node scripts/check-migrations.ts <path-to-nuvana.db>');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('Migration Status Check');
console.log('='.repeat(60));
console.log(`Database path: ${dbPath}`);
console.log('');

try {
  const db = new Database(dbPath, { readonly: true });

  // Check schema_migrations table
  console.log('Applied Migrations:');
  console.log('-'.repeat(60));

  try {
    const migrations = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string; applied_at: string }>;

    if (migrations.length === 0) {
      console.log('  No migrations recorded in schema_migrations table');
    } else {
      for (const m of migrations) {
        console.log(`  v${String(m.version).padStart(3, '0')}: ${m.name} (${m.applied_at})`);
      }
      console.log('');
      console.log(`Total migrations applied: ${migrations.length}`);
      console.log(`Current schema version: ${migrations[migrations.length - 1].version}`);
    }
  } catch (error) {
    console.log('  schema_migrations table does not exist');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Table Schema Check');
  console.log('='.repeat(60));

  // Check lottery_packs table schema
  console.log('');
  console.log('lottery_packs columns:');
  console.log('-'.repeat(60));
  const packColumns = db.prepare("PRAGMA table_info('lottery_packs')").all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  for (const col of packColumns) {
    const isPK = col.pk ? ' [PK]' : '';
    const isCloud = col.name.includes('cloud') ? ' <<<< CLOUD ID COLUMN' : '';
    console.log(`  ${col.name}: ${col.type}${isPK}${isCloud}`);
  }

  // Check users table schema
  console.log('');
  console.log('users columns:');
  console.log('-'.repeat(60));
  const userColumns = db.prepare("PRAGMA table_info('users')").all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  for (const col of userColumns) {
    const isPK = col.pk ? ' [PK]' : '';
    const isCloud = col.name.includes('cloud') ? ' <<<< CLOUD ID COLUMN' : '';
    console.log(`  ${col.name}: ${col.type}${isPK}${isCloud}`);
  }

  // Check lottery_business_days table schema
  console.log('');
  console.log('lottery_business_days columns:');
  console.log('-'.repeat(60));
  const dayColumns = db.prepare("PRAGMA table_info('lottery_business_days')").all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  for (const col of dayColumns) {
    const isPK = col.pk ? ' [PK]' : '';
    const isCloud = col.name.includes('cloud') ? ' <<<< CLOUD ID COLUMN' : '';
    console.log(`  ${col.name}: ${col.type}${isPK}${isCloud}`);
  }

  // Check departments table schema
  console.log('');
  console.log('departments columns:');
  console.log('-'.repeat(60));
  const deptColumns = db.prepare("PRAGMA table_info('departments')").all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  for (const col of deptColumns) {
    const isPK = col.pk ? ' [PK]' : '';
    const isCloud = col.name.includes('cloud') ? ' <<<< CLOUD ID COLUMN' : '';
    console.log(`  ${col.name}: ${col.type}${isPK}${isCloud}`);
  }

  // Check tenders table schema
  console.log('');
  console.log('tenders columns:');
  console.log('-'.repeat(60));
  const tenderColumns = db.prepare("PRAGMA table_info('tenders')").all() as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  for (const col of tenderColumns) {
    const isPK = col.pk ? ' [PK]' : '';
    const isCloud = col.name.includes('cloud') ? ' <<<< CLOUD ID COLUMN' : '';
    console.log(`  ${col.name}: ${col.type}${isPK}${isCloud}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));

  const cloudColumns = [
    ...packColumns.filter((c) => c.name.includes('cloud')).map((c) => `lottery_packs.${c.name}`),
    ...userColumns.filter((c) => c.name.includes('cloud')).map((c) => `users.${c.name}`),
    ...dayColumns
      .filter((c) => c.name.includes('cloud'))
      .map((c) => `lottery_business_days.${c.name}`),
    ...deptColumns.filter((c) => c.name.includes('cloud')).map((c) => `departments.${c.name}`),
    ...tenderColumns.filter((c) => c.name.includes('cloud')).map((c) => `tenders.${c.name}`),
  ];

  if (cloudColumns.length > 0) {
    console.log('');
    console.log('⚠️  Cloud ID columns still present (migrations not yet applied):');
    for (const col of cloudColumns) {
      console.log(`    - ${col}`);
    }
    console.log('');
    console.log('To apply migrations, restart the app or run the migration manually.');
  } else {
    console.log('');
    console.log('✅ All cloud_*_id columns have been removed!');
    console.log('   The ID consolidation migrations have been successfully applied.');
  }

  db.close();
} catch (error) {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
}
