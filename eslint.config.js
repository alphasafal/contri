import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'mcp/dist', 'website/dist', 'node_modules', 'test-results', 'playwright-report', '*.zip'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'tests/**/*.ts', 'mcp/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // Playwright fixtures call a function named `use`; it is not a React hook.
  { files: ['tests/e2e/**/*.ts'], rules: { 'react-hooks/rules-of-hooks': 'off' } },
);
