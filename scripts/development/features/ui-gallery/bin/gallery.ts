/**
 * Renderer UI 画廊的开发服务器。
 *
 * 用真实的 `@linnya/renderer-ui` 组件和 Host 基础样式渲染组件目录与组合示例，
 * 供视觉审阅、改 token 前后对比和三套主题检查。只绑定 127.0.0.1。
 *
 * 用法：pnpm -s ui-gallery [--port 5180] [--strict-port] [--schemes <目录>]
 * 候选方案目录也可用环境变量 LINNYA_UI_GALLERY_SCHEMES_DIR 指定。
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vue from '@vitejs/plugin-vue';
import { createServer } from 'vite';
import { RENDERER_MODULE_RESOLUTION_CATALOG } from '../../../../build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.ts';
import { projectRendererViteAliases } from '../../../../build/renderer-module-resolution/functions/projectRendererViteAliases.ts';
import { createGallerySchemesPlugin } from '../infrastructure/gallerySchemesPlugin.ts';

const DEFAULT_PORT = 5180;

const featureRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(featureRoot, '../../../..');

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'strict-port': { type: 'boolean', default: false },
    schemes: { type: 'string' },
  },
});

async function resolveSchemesDirectory(): Promise<string | null> {
  const requested = values.schemes ?? process.env.LINNYA_UI_GALLERY_SCHEMES_DIR;
  if (requested === undefined || requested === '') return null;
  const directory = path.resolve(requested);
  const entry = await stat(directory).catch((error: unknown) => {
    throw new Error(`候选方案目录不可读：${directory}`, { cause: error });
  });
  if (!entry.isDirectory()) throw new Error(`候选方案路径不是目录：${directory}`);
  return directory;
}

function resolvePort(): number {
  if (values.port === undefined) return DEFAULT_PORT;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`--port 需要 1–65535 的整数：${values.port}`);
  }
  return port;
}

const schemesDirectory = await resolveSchemesDirectory();
const server = await createServer({
  configFile: false,
  root: path.join(featureRoot, 'page'),
  plugins: [vue(), createGallerySchemesPlugin(schemesDirectory)],
  resolve: {
    alias: projectRendererViteAliases(RENDERER_MODULE_RESOLUTION_CATALOG, repositoryRoot, 'vite'),
    dedupe: ['vue'],
  },
  server: {
    host: '127.0.0.1',
    port: resolvePort(),
    strictPort: values['strict-port'],
    fs: { allow: [repositoryRoot] },
  },
  clearScreen: false,
});

await server.listen();
server.printUrls();
console.log(
  schemesDirectory
    ? `  候选方案目录：${schemesDirectory}`
    : '  未指定候选方案目录，只显示现状（--schemes <目录> 或 LINNYA_UI_GALLERY_SCHEMES_DIR）'
);
