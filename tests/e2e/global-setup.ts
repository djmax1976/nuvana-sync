/**
 * Playwright Global Setup
 *
 * Runs once before all E2E tests.
 * Sets up test environment, builds app if needed.
 *
 * @module tests/e2e/global-setup
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Determine if running in CI environment
const isCI = !!process.env.CI;

async function globalSetup(): Promise<void> {
  console.log('\n🚀 E2E Global Setup starting...\n');

  // Check if built app exists
  // In CI: Check for packaged app (downloaded from build job artifact)
  // In dev: Check for development build
  const packagedAppPath = path.join(process.cwd(), 'release', 'win-unpacked', 'Nuvana.exe');
  // electron-vite.config.ts outputs to dist/ (not out/)
  const distPath = path.join(process.cwd(), 'dist', 'main');
  const rendererPath = path.join(process.cwd(), 'dist', 'renderer');

  // In CI, the packaged app should be downloaded from the build job
  if (isCI && fs.existsSync(packagedAppPath)) {
    console.log('✅ Using packaged app from CI build artifact\n');
  } else if (!fs.existsSync(distPath) || !fs.existsSync(rendererPath)) {
    console.log('📦 Building application for E2E tests...');
    try {
      execSync('npm run build', {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
      });
      console.log('✅ Build completed successfully\n');
    } catch (error) {
      console.error('❌ Build failed:', error);
      throw error;
    }
  } else {
    console.log('✅ Using existing development build\n');
  }

  // Set up test database directory
  const testDataDir = path.join(process.cwd(), 'test-data', 'e2e');
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
    console.log(`📁 Created test data directory: ${testDataDir}`);
  }

  // Clean up old test artifacts
  const testResultsDir = path.join(process.cwd(), 'test-results', 'e2e');
  if (fs.existsSync(testResultsDir)) {
    fs.rmSync(testResultsDir, { recursive: true });
    console.log('🧹 Cleaned up old test results');
  }

  // Set environment variables for tests
  process.env.NUVANA_TEST_MODE = 'true';
  process.env.NUVANA_TEST_DATA_DIR = testDataDir;

  console.log('\n✅ Global setup complete\n');
}

export default globalSetup;
