import { build } from 'tsup';
import path from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import backendConfig from '../../tsup.backend.config';
import { resolveQueueWorkerRuntime } from '../../src/infra/task-queue/functions/resolveQueueWorkerRuntime';

const configFile = process.argv[2];
if (!configFile || !path.isAbsolute(configFile))
  throw new Error('Pass an absolute runtime-config.json path');
if (typeof backendConfig !== 'object' || Array.isArray(backendConfig))
  throw new Error('Expected Backend build options');
const hostRoot = path.join(path.dirname(configFile), 'host-root');
const outDir = path.join(hostRoot, 'dist', 'main');
await mkdir(outDir, { recursive: true });
await build({
  ...backendConfig,
  entry: {
    'app-server-entry': 'src/app-hosts/linnya/app-server-runtime/entry/appServerProcessEntry.ts',
    'app-server-backend':
      'src/app-hosts/linnya/testkit/historical-runtime/entry/historicalBackendEntry.ts',
    'historical-launcher':
      'src/app-hosts/linnya/testkit/historical-runtime/entry/historicalLauncher.ts',
  },
  outDir,
  clean: false,
  esbuildPlugins: [],
  plugins: [],
  // 实验参数冻结在独立产物中；生产 bootstrap/env 白名单不认识预测参数。
  define: { 'process.env.LINNYA_HISTORICAL_RUNTIME_CONFIG': JSON.stringify(configFile) },
});
for (const name of [
  'commands',
  'sandbox',
  'plugin-cli-runtime',
  'harfbuzzRuntimeLoader.cjs',
  'yogaRuntimeLoader.cjs',
  'pdfJsRuntimeLoader.cjs',
]) {
  await cp(path.join('dist/main', name), path.join(outDir, name), { recursive: true });
}
for (const worker of Object.values(resolveQueueWorkerRuntime(path.resolve('dist/main')))) {
  await cp(worker, path.join(path.dirname(outDir), path.basename(worker)));
}
for (const resource of ['headless-node-runtime', 'bin/qdrant']) {
  await cp(path.join('extraResources', resource), path.join(hostRoot, 'extraResources', resource), {
    recursive: true,
  });
}
// Markdown owner 在 Backend cwd 下解析 Node wasm；只复制正式产物，不改领域解析或回退到 web wrapper。
await cp('packages/parser-wasm/pkg-node', path.join(hostRoot, 'packages/parser-wasm/pkg-node'), {
  recursive: true,
});
await cp(
  'src/features/skills/builtin/skills/deep-research',
  path.join(hostRoot, 'src/features/skills/builtin/skills/deep-research'),
  { recursive: true }
);
const defaultModels = await readFile(
  'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
);
await writeFile(path.join(hostRoot, 'default_models.json'), defaultModels, { mode: 0o600 });
await writeFile(
  path.join(path.dirname(configFile), 'default-models-sha256.txt'),
  createHash('sha256').update(defaultModels).digest('hex') + '\n'
);
