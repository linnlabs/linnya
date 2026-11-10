import assert from 'node:assert/strict';
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadBackendPluginsFromDisk } from '../../../../../src/electron-main/plugins/loader/diskPluginLoader';

async function run() {
  const suppliedRoot = process.argv[2]; if (!suppliedRoot) throw new Error('Isolated artifact root required');
  const artifactRoot = await realpath(suppliedRoot);
  const app: { version: string } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const loaded = loadBackendPluginsFromDisk({ directPluginDirs: [artifactRoot], appVersion: app.version });
  assert.equal(loaded.length, 1);
  const contribution = loaded[0].contribution;
  assert.deepEqual(contribution.skillResourceRoots, [path.join(artifactRoot, 'resources/skills')]);
  await access(path.join(contribution.skillResourceRoots[0], 'canvas/SKILL.md'));
  const worker = contribution.hiddenWorkers?.[0]; assert(worker);
  assert.equal(worker.workerHtmlPath, path.join(artifactRoot, 'dist/render-worker/worker.html'));
  assert.equal(worker.preloadPath, path.join(artifactRoot, 'dist/backend/render-worker-preload.cjs'));
  await access(worker.workerHtmlPath); await access(worker.preloadPath);
  assert.deepEqual(contribution.pluginMigrations?.map(migration => migration.version), [1]);
  console.log('[canvas-artifact] disk mode discovers isolated skills, worker and migrations');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
