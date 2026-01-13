/**
 * Playwright Global Teardown
 *
 * Runs once after all E2E tests complete.
 * Cleans up test environment, temporary files.
 *
 * @module tests/e2e/global-teardown
 */

import fs from 'fs';
import path from 'path';

async function globalTeardown(): Promise<void> {
  console.log('\n🧹 E2E Global Teardown starting...\n');

  // Clean up test database
  const testDataDir = path.join(process.cwd(), 'test-data', 'e2e');
  if (fs.existsSync(testDataDir)) {
    // Only remove database files, keep directory for debugging
    const files = fs.readdirSync(testDataDir);
    for (const file of files) {
      if (file.endsWith('.db') || file.endsWith('.db-journal')) {
        fs.unlinkSync(path.join(testDataDir, file));
        console.log(`🗑️  Removed test database: ${file}`);
      }
    }
  }

  // Clean up any temporary NAXML files
  const tempNaxmlDir = path.join(testDataDir, 'naxml');
  if (fs.existsSync(tempNaxmlDir)) {
    fs.rmSync(tempNaxmlDir, { recursive: true });
    console.log('🗑️  Removed temporary NAXML files');
  }

  console.log('\n✅ Global teardown complete\n');
}

export default globalTeardown;
