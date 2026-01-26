/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:security/recommended-legacy',
    'plugin:prettier/recommended', // Must be last - disables conflicting rules
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'security', 'prettier'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    // ==========================================================================
    // TYPE SAFETY: Prevent invalid POS type string literals in tests
    // ==========================================================================
    // These rules prevent CI failures from type mismatches like 'SQUARE' vs 'SQUARE_REST'.
    // Always import from tests/fixtures/test-factories.ts instead of using string literals.
    'no-restricted-syntax': [
      'error',
      {
        selector: "Literal[value='SQUARE']",
        message:
          "Use POS_TYPES.SQUARE_REST from 'tests/fixtures/test-factories' instead of 'SQUARE' string literal.",
      },
      {
        selector: "Literal[value='CLOVER']",
        message:
          "Use POS_TYPES.CLOVER_REST from 'tests/fixtures/test-factories' instead of 'CLOVER' string literal.",
      },
    ],

    // Relax rules for early-stage development
    // These can be tightened as the project matures
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'react/react-in-jsx-scope': 'off', // Not needed with React 17+
    'react/prop-types': 'off', // Using TypeScript for prop validation

    // Keep these as errors - they catch real bugs
    'no-console': 'off', // Allow console for Electron app logging
    'no-debugger': 'error',
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // Relaxed for early development - tighten these later
    'prefer-const': 'warn',
    'no-inner-declarations': 'warn', // Functions in main process lifecycle
    'no-useless-escape': 'warn', // Regex patterns in NAXML schema
    'react/no-unescaped-entities': 'warn', // UI text with apostrophes
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'release/',
    '*.cjs', // Config files
    'dashboard/', // External dashboard if present
    'scripts/', // Development/debug scripts
  ],
};
