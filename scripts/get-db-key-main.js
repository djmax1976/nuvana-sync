// Minimal Electron main process script to extract DB key
// This file is loaded directly by Electron as the main entry point

const { app, safeStorage } = require('electron');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Force quit the other instance detection - we're a utility
  app.releaseSingleInstanceLock();
}

// Disable GPU for headless operation
app.disableHardwareAcceleration();

app.on('ready', async () => {
  try {
    const { default: Store } = await import('electron-store');

    console.log('\n=== Nuvana Database Key Extractor ===\n');

    if (!safeStorage.isEncryptionAvailable()) {
      console.error('ERROR: safeStorage encryption is not available');
      process.exit(1);
    }

    const store = new Store({ name: 'nuvana' });
    const storedData = store.get('encryptedDbKey');

    if (!storedData || !Array.isArray(storedData)) {
      console.error('ERROR: No encryption key found');
      console.log('Store path:', store.path);
      process.exit(1);
    }

    const encryptedBuffer = Buffer.from(storedData);
    const decryptedKey = safeStorage.decryptString(encryptedBuffer);

    console.log('DB Path:', app.getPath('userData') + '\\nuvana.db');
    console.log('');
    console.log('KEY:', decryptedKey);
    console.log('');
    console.log('SQLCipher: v4 | KDF: 256000 | PageSize: 4096');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
});

// Prevent window creation
app.on('window-all-closed', () => app.quit());
