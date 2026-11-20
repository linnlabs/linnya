import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { parsePluginManifest } from '@app/schemas';
import { activatePluginVersionWithMigrations } from '../../../src/features/plugins/install/orchestration/activatePluginVersionWithMigrations';
import { seedBundledPlugins } from '../../../src/electron-main/plugins/loader/pluginRuntimeBootstrap';

const [mode, root, workspaceDb, bundledRoot] = process.argv.slice(2);
assert.ok(mode && root && workspaceDb && bundledRoot);
assert.match(basename(root), /^knowledge-upgrade-checkpoint-\d+$/);
assert.equal(workspaceDb, join(root, 'workspace', 'workspace', 'workspace.sqlite'));
const app: unknown = JSON.parse(
  fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version;
assert.ok(typeof app === 'string');
const pluginId = 'knowledge';
const manifest = parsePluginManifest(
  JSON.parse(fs.readFileSync(join(bundledRoot, pluginId, 'plugin.json'), 'utf8'))
);
assert.equal(manifest.id, pluginId);
const userPluginRoot = join(root, 'plugins');
const seed = seedBundledPlugins({ userPluginRoot, bundledPluginRoot: bundledRoot });
assert.ok(seed.some(result => result.pluginId === pluginId && result.status === 'update-staged'));
const db = new Database(workspaceDb, { fileMustExist: true });

function crash(): never {
  fs.writeFileSync(
    join(root, 'upgrade-checkpoint.json'),
    JSON.stringify({ mode, inTransaction: db.inTransaction }),
    { flag: 'wx' }
  );
  process.kill(process.pid, 'SIGKILL');
  throw new Error(`Did not stop at ${mode}`);
}

if (mode === 'before-pointer' || mode === 'after-pointer') {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const pointer = to === join(userPluginRoot, pluginId, 'active.json');
    if (pointer && mode === 'before-pointer') crash();
    rename(from, to);
    if (pointer && mode === 'after-pointer') crash();
  };
}

const result = activatePluginVersionWithMigrations({
  db,
  userPluginRoot,
  pluginId,
  version: manifest.version,
  appVersion: app,
  upgradePlan: {
    pluginId,
    targetVersion: manifest.version,
    compatMin: manifest.compat?.minApp,
    ownedTables: manifest.ownedTables,
    migrations: [
      {
        version: 1,
        description: 'Already applied in the older Desktop',
        up() {
          assert.fail('Old migration replayed');
        },
      },
      {
        version: 2,
        description: 'E7 acceptance schema',
        up(migrationDb) {
          migrationDb.exec(
            'ALTER TABLE knowledge_bases ADD COLUMN e7_checkpoint INTEGER NOT NULL DEFAULT 1'
          );
          if (mode === 'during-migration') crash();
        },
      },
    ],
  },
});
assert.fail(`Upgrade did not reach ${mode}: ${JSON.stringify(result)}`);
