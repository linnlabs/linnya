import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

const nodeGlobals = {
  ...globals.node,
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist_build/**',
      '**/coverage/**',
      'packages/parser-wasm/pkg*/**',
      'packages/parser-wasm/target/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{cjs,js,mjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...nodeGlobals, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.{cts,mts,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...nodeGlobals, ...globals.browser },
    },
    plugins: { '@typescript-eslint': typescriptEslint },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      'no-undef': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...vuePlugin.configs['flat/recommended'],
  {
    files: ['apps/renderer/**/*.vue', 'packages/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: globals.browser,
    },
  },
  {
    files: ['apps/renderer/**/*.{cjs,js,mjs,ts,tsx,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              message: 'Renderer 只能通过 preload/IPC 使用命令能力。',
            },
            {
              name: 'node:child_process',
              message: 'Renderer 只能通过 preload/IPC 使用命令能力。',
            },
          ],
          patterns: [
            {
              regex: '^(@linnlabs/)?linnkit/runtime-kernel($|/(?!events$).+)',
              message: 'Renderer 只能消费 browser-safe Linnkit 合同或 events 子入口。',
            },
            {
              regex: 'infra/adapters/command-runtime/(macos|windows)',
              message: 'Renderer 不能导入平台命令 adapter。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domains/**/*.{cjs,cts,js,mjs,mts,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)src/(app-hosts|electron-main)/',
              message: 'Domain 只能通过 port、contract、event 或 app-level orchestration 协作。',
            },
          ],
        },
      ],
    },
  },
];
