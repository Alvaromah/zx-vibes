import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const jsRules = {
  ...js.configs.recommended.rules,
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

const tsRules = {
  ...jsRules,
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/.packs/**',
      'packages/create-zx-vibes/docs/**',
      'packages/create-zx-vibes/starters/**',
    ],
  },
  {
    files: [
      'packages/emulator/src/**/*.js',
      'packages/emulator/tests/**/*.js',
      'packages/create-zx-vibes/scripts/**/*.js',
      'packages/zx-vibes/bin/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: jsRules,
  },
  {
    files: [
      'packages/asm/src/**/*.ts',
      'packages/asm/tests/**/*.ts',
      'packages/toolkit/src/**/*.ts',
      'packages/toolkit/tests/**/*.ts',
      'packages/create-zx-vibes/src/**/*.ts',
      'packages/zx-vibes/src/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: tsRules,
  },
];
