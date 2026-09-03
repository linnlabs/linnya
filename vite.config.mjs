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
    moduleFragments: ['/node_modules/konva/', '/node_modules/echarts/', '/node_modules/zrender/'],
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
  if (normalizedId.includes(`${editorFeaturePrefix}Revision/`)) return 'renderer-editor-revision'
  if (
    normalizedId.includes(`${editorFeaturePrefix}Annotation/`)
    || normalizedId.includes(`${editorFeaturePrefix}citation/`)
  ) return 'renderer-editor-annotation'
  if (
    normalizedId.includes(`${editorFeaturePrefix}RenderVirtualization/`)
    || normalizedId.includes(`${editorFeaturePrefix}BlockHistory/`)
    || normalizedId.includes(`${editorFeaturePrefix}FindReplace/`)
  ) return 'renderer-editor-runtime'
  if (normalizedId.includes(editorFeaturePrefix)) return 'renderer-editor-interaction'
  if (normalizedId.includes(`${editorPrefix}blocks/`)) return 'renderer-editor-blocks'
  if (normalizedId.includes(`${editorPrefix}definitions/`)) return 'renderer-editor-definitions'
  if (normalizedId.includes(editorPrefix)) return 'renderer-editor-core'

  const conversationPrefix = '/apps/renderer/domains/conversation/'
  if (normalizedId.includes(`${conversationPrefix}ui/tools/`)) return 'renderer-conversation-tools'
  if (
    normalizedId.includes(`${conversationPrefix}ui/message/`)
    || normalizedId.includes(`${conversationPrefix}ui/components/`)
    || normalizedId.includes(`${conversationPrefix}ui/renderers/`)
  ) return 'renderer-conversation-messages'
  if (normalizedId.includes(`${conversationPrefix}ui/`)) return 'renderer-conversation-ui'
  if (normalizedId.includes(`${conversationPrefix}definitions/`)) return 'renderer-conversation-definitions'
  if (normalizedId.includes(conversationPrefix)) return 'renderer-conversation-core'

  const domainMatch = normalizedId.match(/\/apps\/renderer\/domains\/([^/]+)\//)
  return domainMatch ? `renderer-domain-${domainMatch[1]}` : undefined
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
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('[Vite Proxy] 代理错误:', err.message);
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist/renderer',
    rollupOptions: {
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
