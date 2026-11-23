import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const browser = { window: 'readonly', document: 'readonly', fetch: 'readonly', performance: 'readonly', console: 'readonly', Image: 'readonly', ImageData: 'readonly', ImageBitmap: 'readonly', createImageBitmap: 'readonly', devicePixelRatio: 'readonly', addEventListener: 'readonly', HTMLElement: 'readonly', setTimeout: 'readonly', navigator: 'readonly', requestAnimationFrame: 'readonly', Event: 'readonly' };
const node = { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly' };

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'docs/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `noUncheckedIndexedAccess` is on, so `!` after an index is the idiomatic way to say "I know this exists".
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  { files: ['scripts/**/*.mjs', 'playwright.config.ts', 'e2e/**/*.ts'], languageOptions: { globals: { ...node, ...browser } } },
  prettier,
);
