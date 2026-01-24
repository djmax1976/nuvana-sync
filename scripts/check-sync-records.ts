import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(os.homedir(), 'AppData/Roaming/nuvana/nuvana.db');
console.log('Opening database:', dbPath);

const db = new Database(dbPath, { readonly: true });

console.log('\n=== SYNC LOG (Recent Syncs) ===');
try {
  const syncLogs = db
    .prepare(
      `SELECT
        id,
        direction,
        records_sent,
        records_succeeded,
        records_failed,
        started_at,
        completed_at,
        error_message
       FROM sync_log
       WHERE direction='PUSH'
       ORDER BY started_at DESC
       LIMIT 15`
    )
    .all();
  console.log('Recent sync logs:', JSON.stringify(syncLogs, null, 2));
} catch (e) {
  console.log('Error querying sync_log:', e);
}

console.log('\n=== SYNC QUEUE - ALL PACK ITEMS ===');
try {
  const packItems = db
    .prepare(
      `SELECT
        id,
        entity_type,
        entity_id,
        operation,
        payload,
        synced,
        synced_at,
        sync_attempts,
        last_sync_error,
        created_at
       FROM sync_queue
       WHERE entity_type='pack'
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all();
  console.log('Pack sync queue items:', JSON.stringify(packItems, null, 2));
} catch (e) {
  console.log('Error querying sync_queue for packs:', e);
}

console.log('\n=== SYNC QUEUE - ACTIVATED PACKS (Parsed) ===');
try {
  const activatedPacks = db
    .prepare(
      `SELECT
        id,
        entity_id,
        json_extract(payload, '$.pack_id') as pack_id,
        json_extract(payload, '$.bin_id') as bin_id,
        json_extract(payload, '$.opening_serial') as opening_serial,
        json_extract(payload, '$.status') as status,
        json_extract(payload, '$.activated_at') as activated_at,
        json_extract(payload, '$.activated_by') as activated_by,
        synced,
        synced_at,
        sync_attempts,
        last_sync_error
       FROM sync_queue
       WHERE entity_type='pack'
         AND (operation='UPDATE' OR json_extract(payload, '$.status')='ACTIVATED')
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();
  console.log('Activated pack sync details:', JSON.stringify(activatedPacks, null, 2));
} catch (e) {
  console.log('Error parsing activated packs:', e);
}

console.log('\n=== LOTTERY PACKS - ACTIVATED STATUS ===');
try {
  const activePacks = db
    .prepare(
      `SELECT
        pack_id,
        game_id,
        bin_id,
        status,
        opening_serial,
        activated_at,
        activated_by,
        created_at,
        updated_at
       FROM lottery_packs
       WHERE status='ACTIVATED'
       ORDER BY activated_at DESC
       LIMIT 20`
    )
    .all();
  console.log('Currently activated packs in DB:', JSON.stringify(activePacks, null, 2));
} catch (e) {
  console.log('Error querying lottery_packs:', e);
}

console.log('\n=== SYNC QUEUE - PENDING (Not Yet Synced) ===');
try {
  const pending = db
    .prepare(
      `SELECT
        id,
        entity_type,
        entity_id,
        operation,
        payload,
        sync_attempts,
        last_sync_error,
        created_at
       FROM sync_queue
       WHERE synced = 0
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all();
  console.log('Pending sync items:', JSON.stringify(pending, null, 2));
} catch (e) {
  console.log('Error querying pending queue:', e);
}

console.log('\n=== SYNC QUEUE SUMMARY ===');
try {
  const summary = db
    .prepare(
      `SELECT
        entity_type,
        operation,
        synced,
        COUNT(*) as count
       FROM sync_queue
       GROUP BY entity_type, operation, synced
       ORDER BY entity_type, operation`
    )
    .all();
  console.log('Sync queue summary by type/operation/status:', JSON.stringify(summary, null, 2));
} catch (e) {
  console.log('Error getting summary:', e);
}

db.close();
console.log('\nDatabase closed.');
