import rootConfig from './vitest.config';
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

import { RENDERER_MODULE_RESOLUTION_CATALOG } from './scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.js';
import { projectRendererViteAliases } from './scripts/build/renderer-module-resolution/functions/projectRendererViteAliases.js';
import { RENDERER_HOST_INTEGRATION_TESTS, RENDERER_TEST_INCLUDE } from './scripts/test-runner/definitions/rendererTestScope';

export default defineConfig({
  test: {
    projects: [
      {
        extends: false,
        plugins: [vue()],
        resolve: {
          alias: projectRendererViteAliases(RENDERER_MODULE_RESOLUTION_CATALOG, import.meta.dirname, 'vitest'),
        },
        test: {
          name: 'renderer', globals: true, environment: 'node',
          include: RENDERER_TEST_INCLUDE,
          exclude: [...configDefaults.exclude, ...RENDERER_HOST_INTEGRATION_TESTS],
        },
      },
      {
        // 只让已登记的跨层合同测试复用全仓 resolver，生产目录没有新增别名。
        extends: false,
        plugins: [vue()],
        resolve: rootConfig.resolve,
        test: {
          name: 'renderer-host-integration', globals: true, environment: 'node',
          include: RENDERER_HOST_INTEGRATION_TESTS,
        },
      },
    ],
  },
});
