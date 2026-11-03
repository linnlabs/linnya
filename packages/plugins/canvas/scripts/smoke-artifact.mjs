import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import prepareExtraResources from '../../../../scripts/build/prepare-extra-resources.cjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root = path.resolve(packageRoot, '../../..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'linnya-canvas-artifact-'));
const bundledRoot = path.join(temporary, 'plugins'), artifactRoot = path.join(bundledRoot, 'canvas');
const run = (args, environment = process.env) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: environment, encoding: 'utf8', maxBuffer: 10 * 1024 ** 2 });
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error; assert.equal(result.status, 0, `${args.join(' ')} exited ${result.status}`); return result.stdout;
};
try {
  await prepareExtraResources.preparePluginBundles({ pluginIds: ['canvas'], pluginResourceRoot: bundledRoot, resetRoot: true, requireExactPluginIds: true });
  const env = { ...process.env, LINNYA_BUNDLED_PLUGIN_ROOT: bundledRoot, LINNYA_PLUGIN_ARTIFACT_SMOKE_ID: 'canvas', LINNYA_PLUGIN_BACKEND_LOADING: 'disk' };
  run(['scripts/release/verify-plugin-artifact.mjs', 'canvas', '--extra-resources', '--require-renderer-assets'], env);
  run(['--import', 'tsx/cjs', '--eval', "require('./scripts/release/orchestration/verifyPluginArtifactRuntime.ts')"], env);
  run(['--import', 'tsx/cjs', 'packages/plugins/canvas/dev/probes/backendArtifactSmoke.ts', artifactRoot], env);
  const help = run([path.join(artifactRoot, 'dist/cli/canvas-cli.cjs'), '--help']);
  assert.equal(JSON.parse(help.trim()).command, 'canvas standalone');
  const computationProbe = path.join(temporary, 'computation-smoke.cjs');
  await build({ entryPoints: [path.join(packageRoot, 'dev/probes/computationArtifactSmoke.ts')], outfile: computationProbe,
    bundle: true, platform: 'node', format: 'cjs', tsconfig: path.join(root, 'tsconfig.json') });
  run([computationProbe, artifactRoot]);
  run(['packages/plugins/canvas/dev/probes/run-worker-smoke.mjs', artifactRoot]);
  console.log('[canvas-artifact] isolated backend/CLI/computation/HTML/preload/fonts/content passed');
} finally { await rm(temporary, { recursive: true, force: true }); }
