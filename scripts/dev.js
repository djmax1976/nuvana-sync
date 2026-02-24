#!/usr/bin/env node
/**
 * Development script that properly unsets ELECTRON_RUN_AS_NODE
 * before starting electron-vite.
 *
 * This is needed when running from VSCode which sets ELECTRON_RUN_AS_NODE=1
 */

const { spawn } = require('child_process');
const path = require('path');

// Remove ELECTRON_RUN_AS_NODE from environment and ensure NODE_ENV is set
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.NODE_ENV = 'development';

// Path to electron-vite binary
const electronVite = path.join(__dirname, '..', 'node_modules', '.bin', 'electron-vite.cmd');

// Spawn electron-vite dev
const child = spawn(electronVite, ['dev'], {
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('error', (err) => {
  console.error('Failed to start electron-vite:', err);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code);
});
