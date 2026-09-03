import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildSlidesMathFormulaRuntime,
  SLIDES_MATHJAX_RUNTIME_PACKAGE,
  writeSlidesMathFormulaCliRuntimeBridge,
} from './build/buildMathFormulaRuntime.mjs';
import { verifySlidesCliBundle } from './verify-cli-bundle.mjs';

const runEsbuildPath = path.resolve('../../../scripts/build/run-esbuild.mjs');
const hostBackendAliases = [
  'agentRegistry',
  'assetResolution',
  'documentTypeBackendHook',
  'documentImageAsset',
  'documentSvgAsset',
  'fontResolution',
  'imageInspection',
  'imageTranscoding',
  'pluginContribution',
  'pluginMigration',
  'pluginRuntime',
  'sandboxRuntime',
  'textMeasurement',
  'toolRuntime',
  'workspaceRuntime',
  'workspaceDatabasePath',
].map(
  moduleName =>
    `--alias:@plugin/backend/${moduleName}=../../../src/plugin-sdk/backend/${moduleName}.ts`
);

const metadataDirectory = await mkdtemp(path.join(tmpdir(), 'linnya-slides-cli-'));
const metafilePath = path.join(metadataDirectory, 'metafile.json');

try {
  await buildSlidesMathFormulaRuntime();
  const result = spawnSync(
    process.execPath,
    [
      runEsbuildPath,
      'src/backend/features/presentationCli/infrastructure/electronMain.ts',
      '--bundle',
      '--platform=node',
      // 保留函数名和源码结构用于诊断，只消除 bundle 中可机械化约简的语法开销。
      '--minify-syntax',
      '--outfile=dist/cli/slides-cli.cjs',
      '--format=cjs',
      `--metafile=${metafilePath}`,
      ...hostBackendAliases,
      // Standalone CLI 本身就是 Electron Desktop Host，不经过 Linnya App composition。
      // 在构建根显式选择现有 Electron adapter，禁止 SDK 在运行时偷偷 fallback。
      '--alias:@plugin/backend/hiddenWorkerRuntime=../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime.ts',
      '--alias:@plugin/mindmap/shared=../mindmap/src/shared/index.ts',
      '--external:electron',
      '--external:better-sqlite3',
      '--external:sharp',
      '--external:yoga-layout',
      '--external:harfbuzzjs',
      '--external:@node-rs/jieba',
      '--external:pdfjs-dist',
      '--external:pdfjs-dist/legacy/build/pdf',
      `--external:${SLIDES_MATHJAX_RUNTIME_PACKAGE}`,
      '--tsconfig=tsconfig.json',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    }
  );

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    await mkdir('dist/cli', { recursive: true });
    await writeSlidesMathFormulaCliRuntimeBridge();
    await copyFile(
      'src/backend/codegen/compose/flex-layout/yogaRuntimeLoader.cjs',
      'dist/cli/yogaRuntimeLoader.cjs'
    );
    await copyFile(
      '../../../src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs',
      'dist/cli/harfbuzzRuntimeLoader.cjs'
    );
    await verifySlidesCliBundle({
      bundlePath: 'dist/cli/slides-cli.cjs',
      metafilePath,
    });
  }
} finally {
  await rm(metadataDirectory, { recursive: true, force: true });
}
