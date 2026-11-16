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
    // 每条规则只有 error 或 off：警告没人看，只会淹没信号。旧问题记在 eslint-suppressions.json，
    // 见 docs/development/build-and-test.md 的“代码检查基线”。
    linterOptions: { reportUnusedDisableDirectives: 'error' },
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
      // 模块里的 /* global */ 注释重复声明 Node 内置全局不会覆盖任何东西，不算重复声明。
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    // Slides 示例在沙箱里运行，createSlide 等 DSL 全局由 slides-skill 门禁按沙箱声明做类型检查。
    files: ['packages/plugins/slides/resources/skills/slides-design/references/examples/**/*.js'],
    rules: { 'no-undef': 'off' },
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
  {
    // Sandbox 声明提供给独立 deck.js 源码，不能按宿主文件的引用数删掉公开 DSL 类型。
    files: ['packages/plugins/slides/src/backend/sandbox/pptComposeProfile.ambient.d.ts'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  // ESLint 不检查排版：Vue 只启用防错规则（essential），再加几条有语义的规则。
  ...vuePlugin.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    rules: {
      'vue/no-v-html': 'error',
      'vue/require-explicit-emits': 'error',
      'vue/no-template-shadow': 'error',
      'vue/no-lone-template': 'error',
      'vue/no-multiple-slot-args': 'error',
      'vue/no-required-prop-with-default': 'error',
    },
  },
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
