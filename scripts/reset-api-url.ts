/**
 * Script to check and reset the API URL configuration
 *
 * This script helps when the app is using production API instead of local dev server.
 *
 * Usage:
 *   npx tsx scripts/reset-api-url.ts          # Show current config
 *   npx tsx scripts/reset-api-url.ts --reset  # Reset to use development defaults
 */

import Store from 'electron-store';

const store = new Store({ name: 'config' });

console.log('=============================================');
console.log('   API URL CONFIGURATION CHECK              ');
console.log('=============================================\n');

const apiUrl = store.get('apiUrl') as string | undefined;
const legacyEndpoint = store.get('cloudEndpoint') as string | undefined;
const nodeEnv = process.env.NODE_ENV || 'not set';

console.log('Current Configuration:');
console.log(`  NODE_ENV: ${nodeEnv}`);
console.log(`  Stored apiUrl: ${apiUrl || '(not set - will use default)'}`);
console.log(`  Legacy cloudEndpoint: ${legacyEndpoint || '(not set)'}`);

const defaultUrl =
  nodeEnv === 'development' ? 'http://localhost:3001' : 'https://api.nuvanaapp.com';

console.log(`  Default URL for current NODE_ENV: ${defaultUrl}`);
console.log(`  Effective URL: ${apiUrl || legacyEndpoint || defaultUrl}`);
console.log('');

if (process.argv.includes('--reset')) {
  console.log('=== RESETTING API URL ===\n');

  // Delete stored apiUrl so it uses the environment-appropriate default
  store.delete('apiUrl');
  store.delete('cloudEndpoint');

  console.log('Cleared stored API URL configuration.');
  console.log('The app will now use the environment-appropriate default:');
  console.log('  - Development (npm run dev): http://localhost:3001');
  console.log('  - Production (packaged app): https://api.nuvanaapp.com');
  console.log('\nRestart the app for changes to take effect.');
} else {
  if (apiUrl || legacyEndpoint) {
    console.log('NOTE: A custom API URL is stored in config, overriding the default.');
    console.log('Run with --reset to clear and use environment defaults.');
  }
}
