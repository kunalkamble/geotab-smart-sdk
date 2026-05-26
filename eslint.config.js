'use strict';

// ESLint 9 flat config. The SDK is CommonJS Node ≥18, so `.js` here is
// interpreted as CommonJS (no `"type": "module"` in package.json).

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Ignore patterns (replaces .eslintignore)
  {
    ignores: [
      'node_modules/**',
      'docs/**',         // docs site has its own React/Vite stack — not linted here
      'dist/**',
      'coverage/**',
    ],
  },

  // Recommended JS rules
  js.configs.recommended,

  // Project rules for SDK source
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const':   ['warn', { destructuring: 'all' }],
      'no-var':         'error',
      'eqeqeq':         ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'warn',
      'no-console':     'off',  // SDK warns to console intentionally (e.g. pollEvery floor)
    },
  },

  // Tests and examples — slightly looser
  {
    files: ['test/**/*.js', 'examples/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console':     'off',
    },
  },
];
