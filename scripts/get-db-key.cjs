/**
 * Script to extract and display the database encryption key
 * Run with: npx electron scripts/get-db-key.cjs
 */

const { app, safeStorage } = require('electron');
const Store = require('electron-store').default;

const CONFIG_STORE_NAME = 'nuvana-config';
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
  const storedData = store.get(DB_KEY_STORE_KEY);

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

    console.log('Database Path:', app.getPath('userData') + '\\nuvana.db');
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
