import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { installPluginFromBundledAndActivate } from '../../../src/features/plugins/install/orchestration/installPluginFromBundledAndActivate';
import { stageBundledPluginForExplicitInstall } from '../../../src/electron-main/plugins/loader/pluginRuntimeBootstrap';

const [workspaceDb, userPluginRoot, bundledPluginRoot, evidencePath] = process.argv.slice(2);
assert.ok(workspaceDb && userPluginRoot && bundledPluginRoot && evidencePath);
const probeRoot = dirname(evidencePath);
assert.match(basename(probeRoot), /^knowledge-reinstall-crash-\d+$/);
assert.equal(workspaceDb, join(probeRoot, 'workspace', 'workspace', 'workspace.sqlite'));
assert.equal(userPluginRoot, join(probeRoot, 'plugins'));
const appVersion: unknown = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
assert.ok(typeof appVersion === 'string');
const db = new Database(workspaceDb, { fileMustExist: true });
const pluginId = 'knowledge';

const result = installPluginFromBundledAndActivate({
  db, userPluginRoot, pluginId, appVersion, knownPlugins: [],
  stageBundledPlugin: () => stageBundledPluginForExplicitInstall({ bundledPluginRoot, userPluginRoot, pluginId }),
  resolveUpgradePlan({ pluginDir }) {
    // 真实安装编排已写 installed/enabled，但还没调用迁移或写 active；只杀这个独立验收进程。
    const fd = openSync(evidencePath, 'wx');
    writeSync(fd, JSON.stringify({
      pluginDir,
      installed: db.prepare('SELECT installed, user_removed, schema_version FROM installed_plugins WHERE plugin_id=?').get(pluginId),
      enabled: Boolean(db.prepare('SELECT 1 FROM enabled_plugins WHERE plugin_id=?').get(pluginId)),
      active: db.prepare('SELECT active_version FROM plugin_active_versions WHERE plugin_id=?').get(pluginId) ?? null,
    }));
    closeSync(fd);
    process.kill(process.pid, 'SIGKILL');
    throw new Error('Process did not stop at reinstall checkpoint');
  },
});
db.close();
assert.fail(`Reinstall did not reach checkpoint: ${JSON.stringify(result)}`);
