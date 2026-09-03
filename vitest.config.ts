import { defineConfig } from 'vitest/config';
import path from 'path';
import vue from '@vitejs/plugin-vue';

import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from './scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.js';
import {
  projectRendererViteAliases,
} from './scripts/build/renderer-module-resolution/functions/projectRendererViteAliases.js';

const rendererAliases = projectRendererViteAliases(
  RENDERER_MODULE_RESOLUTION_CATALOG,
  import.meta.dirname,
  'vitest',
);

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // 注意：vitest 默认 exclude 包含 node_modules / dist，自定义 exclude 会覆盖默认值，所以必须补回来。
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/example.ts',
        'src/**/index.ts',
      ],
    },
  },
  resolve: {
    // ⚠️ 注意：vite/vitest 的 alias 会进行前缀匹配。
    // 例如 alias '@app' 会劫持 '@app/schemas'，导致把 npm 包 '@app/schemas' 解析到 apps/renderer/app/schemas（不存在）。
    // 因此这里使用数组形式，并把 '@app/schemas' 放在 '@app' 之前做精确命中。
    alias: [
      { find: /^@linnlabs\/linnkit-provider-ai-sdk\/conformance$/, replacement: path.resolve(import.meta.dirname, 'packages/linnkit-provider-ai-sdk/conformance/index.ts') },
      { find: /^@linnlabs\/linnkit-provider-ai-sdk$/, replacement: path.resolve(import.meta.dirname, 'packages/linnkit-provider-ai-sdk/src/index.ts') },
      { find: /^@linnya\/provider-catalog\/runtime-bindings$/, replacement: path.resolve(import.meta.dirname, 'packages/provider-catalog/src/runtime-bindings.ts') },
      { find: /^@linnya\/provider-catalog$/, replacement: path.resolve(import.meta.dirname, 'packages/provider-catalog/src/index.ts') },
      // Linnkit 使用正式 npm 包名，不能在测试配置中 alias 回工作区源码，否则会掩盖发布包漂移。
      { find: /^@linnya\/plugin-host-contract$/, replacement: path.resolve(import.meta.dirname, 'packages/plugin-host-contract/index.ts') },
      { find: /^@linnya\/plugin-host-contract\/backend$/, replacement: path.resolve(import.meta.dirname, 'packages/plugin-host-contract/backend/index.ts') },
      { find: /^@linnya\/plugin-host-contract\/backend\/(.+)$/, replacement: path.resolve(import.meta.dirname, 'packages/plugin-host-contract/backend/$1') },
      { find: /^@linnya\/plugin-host-contract\/renderer$/, replacement: path.resolve(import.meta.dirname, 'packages/plugin-host-contract/renderer/index.ts') },
      { find: /^@linnya\/plugin-host-contract\/renderer\/(.+)$/, replacement: path.resolve(import.meta.dirname, 'packages/plugin-host-contract/renderer/$1') },
      { find: /^@linnya\/text-measurement-core$/, replacement: path.resolve(import.meta.dirname, 'packages/text-measurement-core/src/index.ts') },
      { find: /^@linnya\/citation-domain\/conversation-presentation$/, replacement: path.resolve(import.meta.dirname, 'src/domains/citation/conversation-presentation.ts') },
      { find: /^@linnya\/citation-domain\/markdown-reference$/, replacement: path.resolve(import.meta.dirname, 'src/domains/citation/markdown-reference.ts') },
      // 与 vite.config.mjs / tsconfig.json 保持一致，renderer 集成测试直接读取仓内 Markdown 解析器源码。
      { find: /^stream-markdown-parser$/, replacement: path.resolve(import.meta.dirname, 'packages/stream-markdown-parser/src/index.ts') },

      // Mindmap repo 内插件包公开入口。使用精确正则，避免 @plugin 前缀解析把子入口吞掉。
      { find: /^@plugin\/mindmap\/shared$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/mindmap/src/shared/index.ts') },
      { find: /^@plugin\/mindmap\/backend$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/mindmap/src/backend/index.ts') },
      { find: /^@plugin\/mindmap\/renderer$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/mindmap/src/renderer/index.ts') },
      { find: /^@plugin\/mindmap\/backend-test-support$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/mindmap/src/backend/test-support.ts') },
      { find: /^@plugin\/slides\/shared$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/shared/index.ts') },
      { find: /^@plugin\/slides\/shared\/(.+)$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/shared/$1') },
      { find: /^@plugin\/slides\/backend$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/index.ts') },
      { find: /^@plugin\/slides\/backend-codegen$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/codegen/index.ts') },
      { find: /^@plugin\/slides\/backend-cli-contract$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/features/presentationCli/contract.ts') },
      { find: /^@plugin\/slides\/backend-coordinator$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/coordinator/index.ts') },
      { find: /^@plugin\/slides\/backend-engine-core$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/engine/core.ts') },
      { find: /^@plugin\/slides\/backend-ipc$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/ipc/index.ts') },
      { find: /^@plugin\/slides\/backend-sandbox$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/sandbox/index.ts') },
      { find: /^@plugin\/slides\/backend-tool-classes$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/toolClasses/index.ts') },
      { find: /^@plugin\/slides\/backend-tools$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/tools/index.ts') },
      { find: /^@linnya\/slides-mathjax-runtime$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/backend/engine/mathFormula/runtime/mathJaxSvgRuntime.ts') },
      { find: /^@plugin\/slides\/renderer$/, replacement: path.resolve(import.meta.dirname, 'packages/plugins/slides/src/renderer/index.ts') },
      { find: /^@plugin\/(.+)$/, replacement: path.resolve(import.meta.dirname, 'src/plugin-sdk/$1') },

      // npm 包：@app/schemas（workspace 本地包）
      { find: '@app/schemas', replacement: path.resolve(import.meta.dirname, 'packages/schemas/src') },

      { find: '@transcription', replacement: path.resolve(import.meta.dirname, 'src/features/transcription') },
      { find: '@core', replacement: path.resolve(import.meta.dirname, 'src/core') },
      // 🔥 后端别名：必须放在 '@shared' 之前做精确命中，避免被前端 '@shared' 劫持
      { find: '@shared/logger', replacement: path.resolve(import.meta.dirname, 'src/shared/logger') },
      { find: '@shared/utils', replacement: path.resolve(import.meta.dirname, 'src/shared/utils') },
      { find: '@shared/index', replacement: path.resolve(import.meta.dirname, 'src/shared/index') },
      { find: '@shared/constants', replacement: path.resolve(import.meta.dirname, 'src/shared/constants') },
      { find: '@infra', replacement: path.resolve(import.meta.dirname, 'src/infra') },
      { find: '@shared', replacement: path.resolve(import.meta.dirname, 'apps/renderer/shared') },
      { find: /^src\/(.+)$/, replacement: path.resolve(import.meta.dirname, 'src/$1') },

      // 前端路径别名，与 vite.config.mjs / tsconfig.json 保持一致，便于在测试阶段及早发现路径问题
      { find: '@', replacement: path.resolve(import.meta.dirname, 'apps/renderer') },
      { find: '@app', replacement: path.resolve(import.meta.dirname, 'apps/renderer/app') },
      // 默认 Vitest 仍承载一部分跨 Host/Renderer 集成测试；未被旧全仓 alias 命中的
      // Renderer package 入口必须复用正式 catalog，不能再手写一份路径。
      ...rendererAliases,
    ],
  },
});
