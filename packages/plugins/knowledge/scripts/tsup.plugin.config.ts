import path from 'node:path';
import { defineConfig, type Options } from 'tsup';
import { pluginWorkerSdkAliases } from '../../../../scripts/build/plugin-worker-sdk.mjs';
import { createTsupBundleTrace } from '../../../../scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';
import { knowledgeBundleMetadata } from './build/knowledgeBundleMetadata';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const bundledDependencies = ['zod', '@linnya/foundation', 'uuid', 'adler-32', 'iconv-lite', 'crc-32', '@qdrant/js-client-rest'];
// 与 Desktop 已有 native/解析运行依赖相同；源码与许可仍由正式生产包持有。
const workerExternals = ['better-sqlite3', 'pdfjs-dist', '@napi-rs/canvas', '@node-rs/jieba', 'sharp'];

function buildEntry(name: string, entry: string, worker: boolean): Options {
  const trace = createTsupBundleTrace({ buildTarget: `plugin-knowledge/${name}`, repositoryRoot });
  return {
    entry: { [worker ? `workers/${name}.worker` : name]: entry },
    format: ['cjs'], platform: 'node', target: 'node24', outDir: 'dist/backend',
    clean: false, splitting: false, tsconfig: 'tsconfig.json',
    outExtension: () => ({ js: '.cjs' }),
    external: worker ? workerExternals : [/^@app\/schemas(?:\/|$)/, /^@plugin\/backend\//],
    noExternal: worker ? [...bundledDependencies, /^@app\/schemas(?:\/|$)/] : bundledDependencies,
    esbuildPlugins: [knowledgeBundleMetadata(name), ...trace.esbuildPlugins],
    plugins: trace.plugins,
    esbuildOptions(options) {
      if (worker) options.alias = { ...options.alias, ...pluginWorkerSdkAliases(repositoryRoot) };
    },
  };
}

export default defineConfig([
  buildEntry('index', 'src/backend/index.ts', false),
  buildEntry('knowledgeIngestion', 'src/backend/workers/knowledgeIngestion.worker.ts', true),
  buildEntry('graphExtraction', 'src/backend/workers/graphExtraction.worker.ts', true),
  buildEntry('graphIndexing', 'src/backend/workers/graphIndexing.worker.ts', true),
]);
