import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceArtifactRoot = path.join(repositoryRoot, 'packages/plugins/slides');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'linnya-slides-command-mode-'));
const pluginRoot = path.join(temporaryRoot, 'slides');
const databasePath = path.join(temporaryRoot, 'workspace.sqlite');
const commandEntry = path.join(pluginRoot, 'dist/cli/slides-cli.cjs');

try {
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({
    id: 'slides',
    version: '1.1.1',
    entry: { command: './dist/cli/slides-cli.cjs' },
  }));
  await Promise.all([
    cp(path.join(sourceArtifactRoot, 'dist/cli'), path.join(pluginRoot, 'dist/cli'), {
      recursive: true,
    }),
    cp(
      path.join(sourceArtifactRoot, 'dist/backend/node_modules/@linnya/slides-mathjax-runtime'),
      path.join(pluginRoot, 'dist/backend/node_modules/@linnya/slides-mathjax-runtime'),
      { recursive: true },
    ),
  ]);

  // 临时 artifact 位于系统目录，不能沿仓库父目录碰巧找到 fontkit；后续成功只可能来自
  // command mode 在 require entry 前安装的 Host 白名单解析器。
  assert.throws(
    () => createRequire(commandEntry).resolve('fontkit'),
    /Cannot find module 'fontkit'/,
  );

  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE installed_plugins (plugin_id TEXT PRIMARY KEY, installed INTEGER NOT NULL);
      CREATE TABLE enabled_plugins (plugin_id TEXT PRIMARY KEY);
      INSERT INTO installed_plugins (plugin_id, installed) VALUES ('slides', 1);
      INSERT INTO enabled_plugins (plugin_id) VALUES ('slides');
    `);
  } finally {
    database.close();
  }

  const environment = {
    ...process.env,
    LINNYA_DEV_MODE: 'true',
    LINNYA_PLUGIN_DIRECT_DIRS: pluginRoot,
    LINNYA_PLUGIN_RUNTIME_DATABASE_PATH: databasePath,
  };
  delete environment.NODE_PATH;
  const result = spawnSync(
    path.join(repositoryRoot, 'node_modules/.bin/electron'),
    [
      path.join(repositoryRoot, 'dist/main/main.cjs'),
      '--linnya-plugin-cli',
      'slides',
      'fonts',
      'check',
      '--family',
      'LinnyaDefinitelyMissingFont',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: environment,
      timeout: 60_000,
    },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.deepEqual(report, {
    kind: 'linnya.slides.font-check',
    schemaVersion: 1,
    cliVersion: '1.9.0',
    requestedFamily: 'LinnyaDefinitelyMissingFont',
    installed: false,
  });
  process.stdout.write('[slides-cli-command-mode] external font runtime smoke passed\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
