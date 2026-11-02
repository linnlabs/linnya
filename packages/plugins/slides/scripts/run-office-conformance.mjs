import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter(arg => arg !== '--');
const [stage, output] = args;
if (!['generate', 'export', 'compare', 'all'].includes(stage) || !output || args.length !== 2) {
  console.error(
    'Usage: pnpm run office:conformance -- <generate|export|compare|all> OUTPUT_DIRECTORY'
  );
  process.exit(1);
}
const root = path.resolve(output);
function run(command, argv) {
  if (command === 'pnpm') {
    if (!process.env.npm_execpath)
      throw new Error('Run this script through pnpm run office:conformance');
    argv = [process.env.npm_execpath, ...argv];
    command = process.execPath;
  } else if (command === 'node') command = process.execPath;
  const result = spawnSync(command, argv, { cwd: packageRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
function required(command, argv) {
  const code = run(command, argv);
  if (code !== 0) process.exit(code);
}
if (stage === 'generate' || stage === 'all') {
  mkdirSync(root); // 整轮必须使用新目录，避免新预览混入旧 Office 输出。
  required('pnpm', ['run', 'build:raster-worker']);
  required('pnpm', ['run', 'build:raster-preload']);
  required('node', [
    '../../../scripts/build/run-esbuild.mjs',
    'dev/powerpoint/generate.ts',
    '--bundle',
    '--platform=node',
    '--outfile=dist/dev/office-generate.cjs',
    '--format=cjs',
    '--external:electron',
    '--external:sharp',
    '--alias:@plugin/backend/hiddenWorkerRuntime=../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime.ts',
    '--alias:@plugin/backend/imageInspection=../../../src/plugin-sdk/backend/imageInspection.ts',
    '--alias:@plugin/backend/imageTranscoding=../../../src/plugin-sdk/backend/imageTranscoding.ts',
    '--alias:@plugin/backend/fontResolution=../../../src/plugin-sdk/backend/fontResolution.ts',
    '--alias:@plugin/backend/textMeasurement=../../../src/plugin-sdk/backend/textMeasurement.ts',
    '--tsconfig=tsconfig.json',
  ]);
  copyFileSync(
    path.resolve(
      packageRoot,
      '../../../src/features/text-measurement/infrastructure/system/harfbuzzRuntimeLoader.cjs'
    ),
    path.join(packageRoot, 'dist/dev/harfbuzzRuntimeLoader.cjs')
  );
  required('pnpm', ['exec', 'electron', 'dist/dev/office-generate.cjs', root]);
}
let exportCode = 0;
if (stage === 'export' || stage === 'all')
  exportCode = run('pnpm', ['exec', 'tsx', 'dev/powerpoint/runExport.ts', root]);
if (stage === 'compare' || stage === 'all') {
  // 即使 Office 导出失败也生成 incomplete 报告，方便看日志与已有页面。
  const compareCode = run('pnpm', ['exec', 'tsx', 'dev/powerpoint/runCompare.ts', root]);
  process.exit(exportCode || compareCode);
}
process.exit(exportCode);
