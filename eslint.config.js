import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const sharedGlobals = {
  Buffer: 'readonly',
  Worker: 'readonly',
  URL: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  escape: 'readonly',
  fetch: 'readonly',
  navigator: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  unescape: 'readonly',
  window: 'readonly'
};

export default [
  {
    ignores: ['dist/**', 'playground/dist/**', 'node_modules/**']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'playground/src/**/*.ts', 'playground/src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json'
      },
      globals: sharedGlobals
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      'no-undef': 'off',
      ...tsPlugin.configs.recommended.rules
    }
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
