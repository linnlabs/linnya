import assert from 'node:assert/strict';
import fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas';
import { installPluginFromBundledAndActivate } from '../../../src/features/plugins/install/orchestration/installPluginFromBundledAndActivate';
import { resolvePluginRemovalMarkerPath } from '../../../src/features/plugins/install/functions/pluginRemovalMarker';
import { resolveDiskPluginUpgradePlan } from '../../../src/electron-main/plugins/install/diskPluginUpgradePlan';
import { stageBundledPluginForExplicitInstall } from '../../../src/electron-main/plugins/loader/pluginRuntimeBootstrap';

const [workspaceDb, userPluginRoot, bundledPluginRoot, evidencePath, checkpoint] = process.argv.slice(2);
assert.ok(workspaceDb && userPluginRoot && bundledPluginRoot && evidencePath && checkpoint);
const probeRoot = dirname(evidencePath);
assert.match(basename(probeRoot), /^knowledge-reinstall-crash-\d+$/);
assert.equal(workspaceDb, join(probeRoot, 'workspace', 'workspace', 'workspace.sqlite'));
assert.equal(userPluginRoot, join(probeRoot, 'plugins'));
const appVersion: unknown = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
assert.ok(typeof appVersion === 'string');
const db = new Database(workspaceDb, { fileMustExist: true });
const pluginId = 'knowledge';
const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(join(bundledPluginRoot, pluginId, 'plugin.json'), 'utf8')));

function crash(): never {
  fs.writeFileSync(evidencePath, JSON.stringify({
    checkpoint,
    inTransaction: db.inTransaction,
    installed: db.prepare('SELECT installed, user_removed, schema_version FROM installed_plugins WHERE plugin_id=?').get(pluginId),
    active: db.prepare('SELECT active_version, status FROM plugin_active_versions WHERE plugin_id=?').get(pluginId) ?? null,
  }), { flag: 'wx' });
  process.kill(process.pid, 'SIGKILL');
  throw new Error(`Did not stop at ${checkpoint}`);
}

if (checkpoint === 'before-commit') {
  // activating 是安装事务的最后一笔业务写入；迁移结束但指针尚未提交。
  db.function('acceptance_checkpoint', crash);
  db.exec(`CREATE TEMP TRIGGER acceptance_before_install_commit AFTER INSERT ON main.plugin_active_versions
    WHEN NEW.plugin_id = 'knowledge' AND NEW.status = 'activating' BEGIN SELECT acceptance_checkpoint(); END;`);
} else if (checkpoint === 'before-pointer' || checkpoint === 'after-pointer') {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const pointer = to === join(userPluginRoot, pluginId, 'active.json');
    if (pointer && checkpoint === 'before-pointer') crash();
    rename(from, to);
    if (pointer && checkpoint === 'after-pointer') crash();
  };
} else if (checkpoint === 'before-removal-marker' || checkpoint === 'after-removal-marker') {
  const rm = fs.rmSync;
  const marker = resolvePluginRemovalMarkerPath(userPluginRoot, pluginId);
  fs.rmSync = (target, options) => {
    if (target === marker && checkpoint === 'before-removal-marker') crash();
    rm(target, options);
    if (target === marker && checkpoint === 'after-removal-marker') crash();
  };
}

const result = installPluginFromBundledAndActivate({
  db, userPluginRoot, pluginId, appVersion,
  knownPlugins: [pluginMetaFromManifest(manifest, { builtin: false })],
  stageBundledPlugin() {
    const candidate = stageBundledPluginForExplicitInstall({ bundledPluginRoot, userPluginRoot, pluginId });
    if (checkpoint === 'after-stage') crash();
    return candidate;
  },
  resolveUpgradePlan(input) {
    if (checkpoint === 'after-install-record') crash();
    const plan = resolveDiskPluginUpgradePlan(input);
    if (checkpoint !== 'during-migration') return plan;
    assert.ok(plan.migrations.length > 0);
    return { ...plan, migrations: plan.migrations.map(migration => ({
      ...migration,
      up(migrationDb) {
        migration.up(migrationDb);
        crash();
      },
    })) };
  },
});
db.close();
assert.fail(`Reinstall did not reach checkpoint: ${JSON.stringify(result)}`);
