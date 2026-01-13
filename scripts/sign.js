/**
 * Windows Code Signing Script
 *
 * Supports both local certificate signing and Azure SignTool cloud signing.
 * Used by electron-builder during the packaging process.
 *
 * @module scripts/sign
 * @security SHA-256 signing algorithm, timestamp for long-term validity
 *
 * Environment Variables:
 * - WIN_CSC_LINK: Path to local .pfx certificate file
 * - WIN_CSC_KEY_PASSWORD: Password for the certificate
 * - AZURE_SIGN_TENANT_ID: Azure AD tenant ID for cloud signing
 * - AZURE_SIGN_CLIENT_ID: Azure AD client ID
 * - AZURE_SIGN_CLIENT_SECRET: Azure AD client secret
 * - AZURE_SIGN_VAULT_URL: Azure Key Vault URL
 * - AZURE_SIGN_CERTIFICATE_NAME: Certificate name in Key Vault
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

/**
 * Log message with timestamp
 * @param {string} message
 * @param {'info' | 'error' | 'warn'} level
 */
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [sign] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Validate that required environment variables exist
 * @param {string[]} vars - Variable names to check
 * @returns {boolean}
 */
function validateEnvVars(vars) {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    log(`Missing environment variables: ${missing.join(', ')}`, 'error');
    return false;
  }
  return true;
}

/**
 * Sign using Azure SignTool (cloud-based signing)
 * @param {string} filePath - Path to file to sign
 * @returns {boolean} - Success status
 */
function signWithAzure(filePath) {
  const requiredVars = [
    'AZURE_SIGN_TENANT_ID',
    'AZURE_SIGN_CLIENT_ID',
    'AZURE_SIGN_CLIENT_SECRET',
    'AZURE_SIGN_VAULT_URL',
    'AZURE_SIGN_CERTIFICATE_NAME',
  ];

  if (!validateEnvVars(requiredVars)) {
    return false;
  }

  const command = [
    'AzureSignTool',
    'sign',
    `-kvt "${process.env.AZURE_SIGN_TENANT_ID}"`,
    `-kvu "${process.env.AZURE_SIGN_VAULT_URL}"`,
    `-kvi "${process.env.AZURE_SIGN_CLIENT_ID}"`,
    `-kvs "${process.env.AZURE_SIGN_CLIENT_SECRET}"`,
    `-kvc "${process.env.AZURE_SIGN_CERTIFICATE_NAME}"`,
    '-tr http://timestamp.digicert.com',
    '-td sha256',
    '-fd sha256',
    `"${filePath}"`,
  ].join(' ');

  log('Signing with Azure SignTool...');
  execSync(command, { stdio: 'inherit' });
  return true;
}

/**
 * Sign using local certificate (signtool.exe)
 * @param {string} filePath - Path to file to sign
 * @returns {boolean} - Success status
 */
function signWithLocal(filePath) {
  const requiredVars = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];

  if (!validateEnvVars(requiredVars)) {
    return false;
  }

  const certPath = process.env.WIN_CSC_LINK;

  // Validate certificate file exists
  if (!fs.existsSync(certPath)) {
    log(`Certificate file not found: ${certPath}`, 'error');
    return false;
  }

  // Construct signtool command with proper escaping
  const command = [
    'signtool',
    'sign',
    `/f "${certPath}"`,
    `/p "${process.env.WIN_CSC_KEY_PASSWORD}"`,
    '/tr http://timestamp.digicert.com',
    '/td sha256',
    '/fd sha256',
    '/v',
    `"${filePath}"`,
  ].join(' ');

  log('Signing with local certificate...');
  execSync(command, { stdio: 'inherit' });
  return true;
}

/**
 * Verify signature on a file
 * @param {string} filePath - Path to file to verify
 * @returns {boolean} - Verification success
 */
function verifySignature(filePath) {
  try {
    execSync(`signtool verify /pa /v "${filePath}"`, { stdio: 'inherit' });
    log('Signature verified successfully');
    return true;
  } catch (error) {
    log('Signature verification failed', 'warn');
    return false;
  }
}

/**
 * Main signing function called by electron-builder
 * @param {Object} configuration - electron-builder configuration
 * @param {string} configuration.path - Path to file to sign
 * @param {string} configuration.hash - Hash algorithm
 * @param {boolean} configuration.isNest - Whether this is a nested signature
 * @returns {Promise<void>}
 */
async function sign(configuration) {
  const { path: filePath, hash, isNest } = configuration;

  log(`Starting code signing for: ${path.basename(filePath)}`);
  log(`Hash algorithm: ${hash || 'sha256'}`);
  log(`Nested signature: ${isNest ? 'yes' : 'no'}`);

  // Skip if no signing credentials configured
  if (!process.env.AZURE_SIGN_TENANT_ID && !process.env.WIN_CSC_LINK) {
    log('No signing credentials configured - skipping code signing', 'warn');
    log('Set AZURE_SIGN_* or WIN_CSC_* environment variables to enable signing');
    return;
  }

  try {
    let signed = false;

    // Try Azure SignTool first (preferred for CI/CD)
    if (process.env.AZURE_SIGN_TENANT_ID) {
      signed = signWithAzure(filePath);
    }

    // Fall back to local certificate
    if (!signed && process.env.WIN_CSC_LINK) {
      signed = signWithLocal(filePath);
    }

    if (signed) {
      log('Code signing completed successfully');

      // Verify the signature
      verifySignature(filePath);
    } else {
      throw new Error('No signing method succeeded');
    }
  } catch (error) {
    log(`Code signing failed: ${error.message}`, 'error');

    // In CI, we might want to fail the build
    if (process.env.CI === 'true') {
      throw error;
    }

    // In local development, just warn
    log('Continuing without code signing (development mode)', 'warn');
  }
}

// Export for electron-builder
exports.default = sign;

// Also export individual functions for testing
exports.signWithAzure = signWithAzure;
exports.signWithLocal = signWithLocal;
exports.verifySignature = verifySignature;
