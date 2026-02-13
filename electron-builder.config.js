/**
 * Electron Builder Configuration
 *
 * Enterprise-grade build configuration for Windows NSIS installer.
 * Supports code signing, auto-update, and production distribution.
 *
 * @module electron-builder.config
 * @security Code signing with SHA-256
 * @see https://www.electron.build/configuration/configuration
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

/**
 * Build configuration object
 * @type {import('electron-builder').Configuration}
 */
const config = {
  // Application metadata
  appId: 'com.nuvana.app',
  productName: 'Nuvana',
  copyright: 'Copyright 2024-2025 Nuvana Inc.',

  // Build directories
  directories: {
    output: 'release',
    buildResources: 'resources',
  },

  // Files to include in the build
  files: [
    'dist/**/*',
    'package.json',
    '!**/*.map',
    '!**/node_modules/*/{CHANGELOG.md,README.md,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/node_modules/.bin',
    '!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}',
    '!.editorconfig',
    '!**/._*',
    '!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}',
  ],

  // Extra files to be copied to resources (migrations, etc.)
  extraResources: [
    {
      from: 'src/main/migrations',
      to: 'migrations',
      filter: ['**/*'],
    },
  ],

  // ============================================================================
  // Windows-specific configuration
  // ============================================================================
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'resources/icon.ico',
    artifactName: '${productName}-Setup-${version}.${ext}',
    // Code signing configuration (enabled when certificates are available)
    // signingHashAlgorithms: ['sha256'],
    // sign: process.env.WIN_CSC_LINK ? './scripts/sign.js' : null,
    // certificateFile: process.env.WIN_CSC_LINK,
    // certificatePassword: process.env.WIN_CSC_KEY_PASSWORD,
  },

  // ============================================================================
  // NSIS Installer Configuration
  // ============================================================================
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'resources/icon.ico',
    uninstallerIcon: 'resources/icon.ico',
    installerHeaderIcon: 'resources/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Nuvana',
    // Include custom NSIS script for enhanced installation behavior
    include: 'resources/installer.nsh',
    // License file shown during installation
    license: 'LICENSE.txt',
    // Installer language
    language: 1033, // English (US)
    // Per-machine installation by default
    perMachine: false,
    // Allow elevation for per-machine installation
    allowElevation: true,
    // Installer display language selector
    displayLanguageSelector: false,
    // Uninstaller display name
    uninstallDisplayName: '${productName}',
    // Remove application data prompt on uninstall
    deleteAppDataOnUninstall: false,
  },

  // ============================================================================
  // Auto-Update Configuration (S3)
  // ============================================================================
  publish: [
    {
      provider: 's3',
      bucket: process.env.UPDATE_BUCKET || 'nuvana-updates',
      region: process.env.UPDATE_REGION || 'us-east-1',
      path: '/releases',
      // ACL: Use bucket policy instead of per-object ACL
      acl: null,
    },
  ],

  // ============================================================================
  // Build Hooks
  // ============================================================================
  afterPack: async (context) => {
    console.log(`[electron-builder] After pack: ${context.appOutDir}`);
  },

  afterSign: async (context) => {
    console.log(`[electron-builder] After sign: ${context.appOutDir}`);
  },

  // ============================================================================
  // Compression and optimization
  // ============================================================================
  compression: 'maximum',
  removePackageScripts: true,
  asar: true,
  asarUnpack: [
    // Unpack native modules if needed
    '**/*.node',
    '**/better-sqlite3-multiple-ciphers/**',
    '**/bcrypt/**',
  ],
};

module.exports = config;
