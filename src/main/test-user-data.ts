/**
 * Test User Data Isolation
 *
 * Overrides the Electron userData path when NUVANA_TEST_USER_DATA is set.
 * This MUST be imported before any module that creates an electron-store
 * instance (e.g., settings.service.ts), because electron-store reads
 * app.getPath('userData') at construction time.
 *
 * @module main/test-user-data
 */

import { app } from 'electron';

const testUserData = process.env.NUVANA_TEST_USER_DATA;
if (testUserData) {
  app.setPath('userData', testUserData);
}
