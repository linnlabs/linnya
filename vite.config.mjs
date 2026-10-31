import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

import { createViteBundleTracePlugin } from './scripts/build/bundle-trace/adapters/viteBundleTracePlugin.mjs'
import { RENDERER_MODULE_RESOLUTION_CATALOG } from './scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.ts'
import { projectRendererViteAliases } from './scripts/build/renderer-module-resolution/functions/projectRendererViteAliases.ts'
import { discoverWorkspaceRendererOptimizeDependencies } from './scripts/development/features/plugin-renderer-dependency-optimization/functions/discoverWorkspaceRendererOptimizeDependencies.mjs'

const rendererAliases = projectRendererViteAliases(
  RENDERER_MODULE_RESOLUTION_CATALOG,
  import.meta.dirname,
  'vite',
)
const workspacePluginRendererOptimizeDependencies =
  discoverWorkspaceRendererOptimizeDependencies(import.meta.dirname)

const RENDERER_VENDOR_CHUNKS = [
  {
    name: 'vendor-vue',
    moduleFragments: ['/node_modules/vue/', '/node_modules/@vue/', '/node_modules/pinia/'],
  },
  {
    name: 'vendor-tiptap',
    moduleFragments: [
      '/node_modules/@tiptap/',
      '/node_modules/tippy.js/',
      '/node_modules/@popperjs/',
    ],
  },
  {
    name: 'vendor-prosemirror',
    moduleFragments: [
      '/node_modules/prosemirror-',
      '/node_modules/orderedmap/',
      '/node_modules/rope-sequence/',
    ],
  },
  {
    name: 'vendor-markdown',
    moduleFragments: [
      '/node_modules/markdown-it',
      '/node_modules/highlight.js/',
      '/node_modules/lowlight/',
      '/node_modules/hast-',
      '/node_modules/rehype-',
      '/node_modules/remark-',
      '/node_modules/unified/',
    ],
  },
  {
    name: 'vendor-katex',
    moduleFragments: ['/node_modules/katex/'],
  },
  {
    name: 'vendor-lodash',
    moduleFragments: ['/node_modules/lodash/'],
  },
  {
    name: 'vendor-visualization',
    moduleFragments: ['/node_modules/konva/'],
  },
  {
    // 图表块的运行时只经动态 import 进入：独立成块，文档里没有图表时不加载，也不拖大随 konva 预加载的块。
    name: 'vendor-charts',
    moduleFragments: ['/node_modules/echarts/', '/node_modules/zrender/'],
  },
  {
    name: 'vendor-validation',
    moduleFragments: ['/node_modules/zod/'],
  },
  {
    name: 'vendor-ui-runtime',
    moduleFragments: [
      '/node_modules/@floating-ui/',
      '/node_modules/@tanstack/virtual-core/',
      '/node_modules/@vueuse/',
      '/node_modules/overlayscrollbars/',
    ],
  },
  {
    name: 'vendor-text-utils',
    moduleFragments: [
      '/node_modules/@chenglou/pretext/',
      '/node_modules/diff-match-patch/',
      '/node_modules/dompurify/',
      '/node_modules/entities/',
      '/node_modules/marked/',
    ],
  },
  {
    name: 'vendor-network',
    moduleFragments: ['/node_modules/axios/'],
  },
]

/**
 * 只按稳定第三方包边界拆分，不按业务目录机械切块。
 * 业务模块仍由动态 import 决定加载时机，vendor chunk 则获得独立缓存和解析边界。
 */
export function resolveRendererManualChunk(moduleId) {
  if (moduleId.includes('/node_modules/')) {
    return RENDERER_VENDOR_CHUNKS.find(({ moduleFragments }) => (
      moduleFragments.some((fragment) => moduleId.includes(fragment))
    ))?.name ?? 'vendor-misc'
  }

  const normalizedId = moduleId.replaceAll('\\', '/')
  const editorPrefix = '/apps/renderer/domains/editor/'
  const editorFeaturePrefix = `${editorPrefix}features/`
  // 图表运行时（ECharts 注册）只经动态 import 到达：单独成块，才能让 vendor-charts 保持按需加载，
  // 不被归入随编辑器启动加载的 interaction 块而变成静态依赖。
  if (normalizedId.includes(`${editorFeaturePrefix}chart-reading/orchestration/runtime/`)) return 'renderer-editor-chart-runtime'
  // 目录不是运行期依赖边界；强制拆分互相引用的业务模块会让常量在初始化前被访问，导致成品白屏。
  // 交给 Rollup 按实际依赖与动态 import 分块，保留上面明确独立的图表加载边界。
  return undefined
}

export default defineConfig(() => {
  return {
  base: './',
  plugins: [
    vue(),
    wasm(),
    topLevelAwait(),
    createViteBundleTracePlugin({
      buildTarget: 'desktop/renderer',
      repositoryRoot: import.meta.dirname,
    }),
  ],
  resolve: {
    alias: rendererAliases,
    dedupe: [
      'vue',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      'prosemirror-commands',
      'prosemirror-history',
      'prosemirror-inputrules',
      'prosemirror-keymap',
      'prosemirror-schema-list',
      'prosemirror-schema-basic',
      'prosemirror-dropcursor',
      'prosemirror-gapcursor',
      'prosemirror-tables',
      'y-prosemirror'
    ]
  },
  server: {
    // 数据写入和隐藏窗口制品不属于主 Renderer 的 HMR 输入。
    watch: { ignored: ['**/_dev_data/**', '**/_dev_electron/**', '**/dist/main/**', '**/dist/*-worker/**'] },
    // 利用 Backend 准备时间转换入口，避免首次开窗才从零遍历模块依赖。
    warmup: { clientFiles: ['./apps/renderer/app/main.js', './apps/renderer/app/App.vue'] },
    host: true,
    allowedHosts: [
      'localhost:5173'
    ],
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    },
    fs: {
      allow: ['..']
    },
    proxy: {
      // 将所有 /api 请求代理到后端服务器
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Vite Proxy] 代理错误:', err.message);
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
      onwarn(warning, warn) {
        // 成品已实测出现初始化顺序错误；不能再让循环 chunk 仅以警告通过源码 CI。
        if (warning.code === 'CIRCULAR_CHUNK') {
          throw new Error(warning.message)
        }
        warn(warning)
      },
      // 确保 stream-markdown-parser 的依赖能被正确解析
      output: {
        manualChunks: resolveRendererManualChunk,
      }
    }
  },
  optimizeDeps: {
    // 插件 renderer 入口由主应用运行时动态 import，Vite 默认只从主入口扫描时
    // 不一定能提前发现插件依赖；提前纳入扫描可避免开发/测试启动后边优化边整页 reload。
    entries: [
      'index.html',
      'apps/renderer/app/main.js',
      'packages/plugins/*/src/renderer/index.ts'
    ],
    include: [
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      'prosemirror-commands',
      'prosemirror-history',
      'prosemirror-inputrules',
      'prosemirror-keymap',
      'prosemirror-schema-list',
      'prosemirror-schema-basic',
      'prosemirror-dropcursor',
      'prosemirror-gapcursor',
      'prosemirror-tables',
      // stream-markdown-parser 的依赖
      'markdown-it-footnote',
      'markdown-it-ins',
      'markdown-it-mark',
      'markdown-it-sub',
      'markdown-it-sup',
      'markdown-it-task-checkbox',
      'markdown-it-container',
      'markdown-it-ts',
      'pinia',
      'vue',
      // 具体插件依赖由 owner 的 package metadata 声明；Host 不保存插件实现清单。
      ...workspacePluginRendererOptimizeDependencies,
    ],
    preserveSymlinks: true,
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    },
    exclude: ['parser-wasm']
  },
  assetsInclude: ['**/*.wasm']
  }
})
