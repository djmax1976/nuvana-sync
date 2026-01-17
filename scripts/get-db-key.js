const { app, safeStorage } = require('electron');

const CONFIG_STORE_NAME = 'nuvana-config';
const DB_KEY_STORE_KEY = 'encryptedDbKey';

app.whenReady().then(async () => {
  // Dynamic import for electron-store (ESM)
  const { default: Store } = await import('electron-store');

  console.log('\n=== Nuvana Database Key Extractor ===\n');

  if (!safeStorage.isEncryptionAvailable()) {
    console.error('ERROR: safeStorage encryption is not available');
    app.quit();
    return;
  }

  const store = new Store({ name: CONFIG_STORE_NAME });
  const storedData = store.get(DB_KEY_STORE_KEY);

  if (!storedData || !Array.isArray(storedData)) {
    console.error('ERROR: No encryption key found in store');
    console.log('Store path:', store.path);
    app.quit();
    return;
  }

  try {
    const encryptedBuffer = Buffer.from(storedData);
    const decryptedKey = safeStorage.decryptString(encryptedBuffer);

    console.log('Database Path:', app.getPath('userData') + '\\nuvana.db');
    console.log('');
    console.log('Encryption Key:');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(decryptedKey);
    console.log('════════════════════════════════════════════════════════════════');
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
