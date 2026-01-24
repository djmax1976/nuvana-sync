/**
 * Script to extract and display the database encryption key
 * Run with: npx tsx scripts/get-db-key.ts
 *
 * NOTE: This must be run as an Electron script since it uses safeStorage
 */

import { app, safeStorage } from 'electron';
import Store from 'electron-store';

const CONFIG_STORE_NAME = 'nuvana';
const DB_KEY_STORE_KEY = 'encryptedDbKey';

app.whenReady().then(() => {
  console.log('\n=== Nuvana Database Key Extractor ===\n');

  // Check if safeStorage is available
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('ERROR: safeStorage encryption is not available');
    app.quit();
    return;
  }

  // Get the config store
  const store = new Store({ name: CONFIG_STORE_NAME });
  const storedData = store.get(DB_KEY_STORE_KEY) as number[] | undefined;

  if (!storedData || !Array.isArray(storedData)) {
    console.error('ERROR: No encryption key found in store');
    console.log('Store path:', store.path);
    app.quit();
    return;
  }

  try {
    // Decrypt the key
    const encryptedBuffer = Buffer.from(storedData);
    const decryptedKey = safeStorage.decryptString(encryptedBuffer);

    console.log('Database Path: %AppData%\\nuvana\\nuvana.db');
    console.log('             : ' + app.getPath('userData') + '\\nuvana.db');
    console.log('');
    console.log('Encryption Key (copy this for DB Browser):');
    console.log('─'.repeat(64));
    console.log(decryptedKey);
    console.log('─'.repeat(64));
    console.log('');
    console.log('SQLCipher Settings for DB Browser:');
    console.log('  - Encryption: SQLCipher 4');
    console.log('  - KDF Iterations: 256000');
    console.log('  - Page Size: 4096');
    console.log('');
  } catch (error) {
    console.error('ERROR: Failed to decrypt key:', error);
  }

  app.quit();
});
