import { defineConfig } from 'tsup';
import { cp, mkdir, copyFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';
import { createTsupBundleTrace } from '../../../scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';
import { copySlidesTypeScriptRuntime } from './scripts/build/copyTypeScriptRuntime.mjs';
import {
  buildSlidesMathFormulaRuntime,
  SLIDES_MATHJAX_RUNTIME_PACKAGE,
} from './scripts/build/buildMathFormulaRuntime.mjs';
import { verifySlidesBackendBundle } from './scripts/verify-backend-bundle.mjs';

const hostBackendExternal = /^@plugin\/backend\//;
const packageDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageDir, '../../..');
const bundleTrace = createTsupBundleTrace({
  buildTarget: 'plugin-slides/backend',
  repositoryRoot,
});
const backendDir = 'dist/backend';
const backendMetafilePath = join(backendDir, 'metafile-cjs.json');
const packageRequire = createRequire(import.meta.url);
const pptxGenCommonJsEntry = packageRequire.resolve('pptxgenjs');

/**
 * backend 制品必须选择 PptxGenJS 的 Node/CommonJS 入口。
 * 默认 import condition 会选浏览器兼容 ESM 入口，重新带回 Electron VM 不支持的动态 import。
 */
function nodePptxGenEntryPlugin(): Plugin {
  return {
    name: 'slides-node-pptxgen-entry',
    setup(build) {
      build.onResolve({ filter: /^pptxgenjs$/ }, () => ({ path: pptxGenCommonJsEntry }));
    },
  };
}

/** 私有 MathJax runtime 是 artifact 内的单一物理副本，不能被 tsconfig alias 再内联。 */
function externalMathFormulaRuntimePlugin(): Plugin {
  return {
    name: 'slides-external-math-formula-runtime',
    setup(build) {
      build.onResolve(
        { filter: /^@linnya\/slides-mathjax-runtime$/ },
        args => ({ path: args.path, external: true }),
      );
    },
  };
}

async function copyResource(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyBackendResources(): Promise<void> {
  await copyResource(
    'src/backend/sandbox/pptComposeProfile.ambient.d.ts',
    'dist/backend/sandbox/pptComposeProfile.ambient.d.ts'
  );
  await copySlidesTypeScriptRuntime({
    targetDir: join(backendDir, 'node_modules/typescript'),
  });
  await copyResource(
    'src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs',
    'dist/backend/yogaRuntimeLoader.cjs'
  );
  await copyResource(
    'src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs',
    'dist/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs'
  );
  const yogaTarget = 'dist/backend/node_modules/yoga-layout';
  await rm(yogaTarget, { recursive: true, force: true });
  await cp('../../../node_modules/yoga-layout', yogaTarget, {
    recursive: true,
    force: true,
    dereference: true,
  });
}

async function finalizeBackendBuild(): Promise<void> {
  await buildSlidesMathFormulaRuntime();
  await copyBackendResources();
  try {
    await verifySlidesBackendBundle({
      backendDir,
      bundlePath: join(backendDir, 'index.cjs'),
      metafilePath: backendMetafilePath,
    });
  } finally {
    // metafile 只服务构建图门禁，不进入插件发布制品。
    await rm(backendMetafilePath, { force: true });
  }
}

export default defineConfig({
  entry: {
    index: 'src/backend/index.ts',
    'raster-worker-preload': 'src/backend/features/slideRasterWorker/infrastructure/preload.ts',
    'brush-worker-preload':
      'src/backend/features/presentationBrushArtworkGeneration/infrastructure/preload.ts',
    'presentation-build-worker':
      'src/backend/features/presentationBuildExecution/infrastructure/workerEntry.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist/backend',
  clean: true,
  splitting: false,
  treeshake: true,
  metafile: true,
  esbuildPlugins: [
    externalMathFormulaRuntimePlugin(),
    nodePptxGenEntryPlugin(),
    ...bundleTrace.esbuildPlugins,
  ],
  plugins: bundleTrace.plugins,
  tsconfig: 'tsconfig.json',
  external: [
    'electron',
    'better-sqlite3',
    '@app/schemas',
    SLIDES_MATHJAX_RUNTIME_PACKAGE,
    hostBackendExternal,
  ],
  noExternal: [
    '@xmldom/xmldom',
    '@linnya/text-measurement-core',
    'acorn',
    'diff-match-patch',
    'jszip',
    'pptx-automizer',
    'pptxgenjs',
    'uuid',
    'zod',
  ],
  outExtension() {
    return {
      js: '.cjs',
    };
  },
  onSuccess: finalizeBackendBuild,
});
