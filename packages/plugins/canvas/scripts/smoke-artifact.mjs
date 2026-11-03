import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';
import { createHash } from 'node:crypto';
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
  run(['--import', 'tsx', 'packages/plugins/canvas/dev/probes/backendArtifactSmoke.ts', artifactRoot], env);
  const help = run([path.join(artifactRoot, 'dist/cli/canvas-cli.cjs'), '--help']);
  assert.equal(JSON.parse(help.trim()).command, 'canvas standalone');
  const computationProbe = path.join(temporary, 'computation-smoke.cjs');
  await build({ entryPoints: [path.join(packageRoot, 'dev/probes/computationArtifactSmoke.ts')], outfile: computationProbe,
    bundle: true, platform: 'node', format: 'cjs', tsconfig: path.join(root, 'tsconfig.json') });
  run([computationProbe, artifactRoot]);
  const standaloneProbe = path.join(root, '_dev_data/canvas-artifact-standalone.cjs');
  await build({ entryPoints: [path.join(packageRoot, 'dev/probes/standaloneArtifactSmoke.ts')], outfile: standaloneProbe,
    bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], tsconfig: path.join(root, 'tsconfig.json') });
  const database = path.join(temporary, 'readonly.sqlite');
  const native = mode => {
    const result = spawnSync(electron, [standaloneProbe, artifactRoot, database, mode], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 ** 2 });
    if (result.error) throw result.error; if (result.stderr) process.stderr.write(result.stderr); return result;
  };
  assert.equal(native('fixture').status, 0);
  const hash = async () => createHash('sha256').update(await readFile(database)).digest('hex');
  const before = await hash(), read = native('read');
  assert.equal(read.status, 0, read.stdout); assert.equal(JSON.parse(read.stdout.trim()).sequence, 0); assert(read.stdout.includes('只读制品'));
  const rejected = native('apply'); assert.equal(rejected.status, 8); assert.equal(JSON.parse(rejected.stdout.trim()).error.code, 'read_only');
  assert.equal(await hash(), before, 'compiled readonly CLI changed database bytes');
  console.log('[canvas-artifact] compiled CLI actual readonly database and mutation refusal passed');
  run(['packages/plugins/canvas/dev/probes/run-worker-smoke.mjs', artifactRoot]);
  console.log('[canvas-artifact] isolated backend/CLI/computation/HTML/preload/fonts/content passed');
} finally { await rm(temporary, { recursive: true, force: true }); }
