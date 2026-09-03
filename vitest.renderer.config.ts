import path from 'node:path';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from './scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.js';
import {
  projectRendererViteAliases,
  type RendererViteAlias,
} from './scripts/build/renderer-module-resolution/functions/projectRendererViteAliases.js';

const repositoryRoot = import.meta.dirname;

/**
 * 这些入口只服务跨边界集成测试，不属于生产 Renderer profile。
 * 测试若需要新增 Host 源码入口，必须在这里逐条说明，禁止扩回宽泛 backend alias。
 */
const RENDERER_TEST_SUPPORT_ALIASES: readonly RendererViteAlias[] = [
  {
    find: /^@plugin\/(mindmap|slides)\/renderer$/u,
    replacement: path.resolve(repositoryRoot, 'packages/plugins/$1/src/renderer/index.ts'),
  },
  {
    find: /^src\/app-hosts\/(.+)$/u,
    replacement: path.resolve(repositoryRoot, 'src/app-hosts/$1'),
  },
  {
    find: /^src\/domains\/markdown$/u,
    replacement: path.resolve(repositoryRoot, 'src/domains/markdown/index.ts'),
  },
];

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/renderer/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'packages/renderer-ui/**/*.{test,spec}.{ts,tsx}',
      'packages/plugins/mindmap/src/renderer/**/*.{test,spec}.{ts,tsx}',
      'packages/plugins/slides/src/renderer/**/*.{test,spec}.{ts,tsx}',
      'scripts/build/renderer-module-resolution/**/*.{test,spec}.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
  resolve: {
    alias: [
      ...projectRendererViteAliases(
        RENDERER_MODULE_RESOLUTION_CATALOG,
        repositoryRoot,
        'vitest',
      ),
      ...RENDERER_TEST_SUPPORT_ALIASES,
    ],
  },
});
