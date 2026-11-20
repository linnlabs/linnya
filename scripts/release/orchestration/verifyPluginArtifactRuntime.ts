import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { parsePluginManifest, pluginMetaFromManifest } from '@app/schemas';
import { loadBackendPluginsFromDisk } from '../../../src/electron-main/plugins/loader/diskPluginLoader';
import { seedBundledPlugins, stageBundledPluginForExplicitInstall } from '../../../src/electron-main/plugins/loader/pluginRuntimeBootstrap';
import { resolveDiskPluginUpgradePlan } from '../../../src/electron-main/plugins/install/diskPluginUpgradePlan';
import { PLATFORM_PLUGIN_META } from '../../../src/app-hosts/linnya/plugin-registry/builtin/platform-meta';
import { PluginStateService } from '../../../src/features/plugins/infrastructure/sqlite/plugin-state.service';
import { PluginActiveVersionService } from '../../../src/features/plugins/infrastructure/sqlite/plugin-active-version.service';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from '../../../src/features/plugins/infrastructure/sqlite/plugin-state.schema';
import { CORE_SCHEMAS } from '../../../src/features/workspace/infrastructure/sqlite/schemas/core.schema';
import { WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS } from '../../../src/features/workspace/infrastructure/sqlite/schemas/node-text-snapshot.schema';
import { isPluginUserRemoved } from '../../../src/features/plugins/install/functions/pluginRemovalMarker';
import { installPluginFromBundledAndActivate } from '../../../src/features/plugins/install/orchestration/installPluginFromBundledAndActivate';
import { uninstallPluginLifecycle } from '../../../src/features/plugins/install/orchestration/uninstallPluginLifecycle';
import { assertBundledPluginRootMatchesPluginIds } from '../functions/pluginBundledRootContract.mjs';

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the plugin artifact runtime smoke`);
  }
  return value;
}

function readAppVersion(): string {
  const input: unknown = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('root package.json must be an object');
  }
  const version = 'version' in input ? input.version : undefined;
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('root package.json must declare a non-empty version');
  }
  return version;
}

const pluginId = readRequiredEnvironmentVariable('LINNYA_PLUGIN_ARTIFACT_SMOKE_ID');
const bundledPluginRoot = readRequiredEnvironmentVariable('LINNYA_BUNDLED_PLUGIN_ROOT');
const pluginDirectory = path.join(bundledPluginRoot, pluginId);

assertBundledPluginRootMatchesPluginIds({
  bundledPluginRoot,
  expectedPluginIds: [pluginId],
});

const manifestInput: unknown = JSON.parse(
  fs.readFileSync(path.join(pluginDirectory, 'plugin.json'), 'utf8')
);
const manifest = parsePluginManifest(manifestInput);
const applicationVersion = readAppVersion();
const loadedPlugins = loadBackendPluginsFromDisk({
  directPluginDirs: [pluginDirectory],
  appVersion: applicationVersion,
});

if (loadedPlugins.length !== 1) {
  throw new Error(
    `${pluginId} isolated artifact runtime smoke expected one backend contribution, loaded=${loadedPlugins.length}`
  );
}
const loadedPlugin = loadedPlugins[0];
if (
  loadedPlugin?.contribution.meta.id !== manifest.id ||
  loadedPlugin.contribution.meta.version !== manifest.version
) {
  throw new Error(
    `${pluginId} isolated artifact runtime identity mismatch: manifest=${manifest.id}@${manifest.version}, loaded=${loadedPlugin?.contribution.meta.id ?? 'missing'}@${loadedPlugin?.contribution.meta.version ?? 'missing'}`
  );
}

// 使用发版脚本创建的隔离目录：不读取应用 profile，也不复用开发库或运行中的插件。
const profile = path.join(path.dirname(bundledPluginRoot), 'profile');
fs.mkdirSync(profile, { recursive: true });
const userPluginRoot = path.join(profile, 'plugins');
const db = new Database(path.join(profile, 'workspace.sqlite'));
try {
  for (const ddl of [...CORE_SCHEMAS, ...WORKSPACE_NODE_TEXT_SNAPSHOT_SCHEMAS, ...PLUGIN_PLATFORM_STATE_SCHEMAS]) db.exec(ddl);
  const plugin = pluginMetaFromManifest(manifest, { builtin: true, required: false });
  const knownPlugins = [PLATFORM_PLUGIN_META, plugin];
  const state = new PluginStateService(db);
  const active = new PluginActiveVersionService(db);
  state.ensureBuiltinInstalled([PLATFORM_PLUGIN_META]);
  const install = () => installPluginFromBundledAndActivate({
    db, userPluginRoot, pluginId, knownPlugins, appVersion: applicationVersion,
    stageBundledPlugin: () => stageBundledPluginForExplicitInstall({ bundledPluginRoot, userPluginRoot, pluginId }),
    resolveUpgradePlan: resolveDiskPluginUpgradePlan,
  });
  const listOwnedTables = () => db.prepare<[string], { name: string; sql: string }>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  );
  const readLedger = () => db.prepare('SELECT version, applied_at FROM plugin_migrations WHERE plugin_id = ? ORDER BY version').all(pluginId);
  const activeManifest = path.join(userPluginRoot, pluginId, 'active.json');
  const assertInstalled = () => {
    assert.equal(state.getInstalledRecord(pluginId)?.version, manifest.version);
    assert.equal(state.getInstalledRecord(pluginId)?.installed, true);
    assert.ok(state.getEnabledIds().includes(pluginId));
    assert.equal(active.getRecord(pluginId)?.activeVersion, manifest.version);
    assert.equal(JSON.parse(fs.readFileSync(activeManifest, 'utf8')).version, manifest.version);
    assert.equal(isPluginUserRemoved(userPluginRoot, pluginId), false);
    assert.ok(loadBackendPluginsFromDisk({ pluginRoot: userPluginRoot, appVersion: applicationVersion })
      .some(result => result.contribution.meta.id === pluginId));
  };
  assert.equal(state.getInstalledRecord(pluginId), null);
  const first = install();
  assert.equal(first.status, 'installed', JSON.stringify(first));
  assertInstalled();
  const originalLedger = readLedger();
  assert.equal(originalLedger.length, manifest.migrations.length);
  const tables = listOwnedTables();
  const originalSchema = manifest.ownedTables.map(table => {
    const row = tables.get(table);
    assert.ok(row, `Missing owned table: ${table}`);
    return row;
  });
  state.setEnabled(pluginId, false, knownPlugins);
  assert.ok(!state.getEnabledIds().includes(pluginId));
  assert.equal(active.getRecord(pluginId)?.activeVersion, manifest.version);
  state.setEnabled(pluginId, true, knownPlugins);
  const removed = uninstallPluginLifecycle({ db, userPluginRoot, pluginId, knownPlugins });
  assert.equal(removed.status, 'uninstalled', JSON.stringify(removed));
  assert.ok(!state.getEnabledIds().includes(pluginId));
  assert.equal(active.getRecord(pluginId), null);
  assert.equal(fs.existsSync(activeManifest), false);
  assert.equal(isPluginUserRemoved(userPluginRoot, pluginId), true);
  assert.equal(seedBundledPlugins({ bundledPluginRoot, userPluginRoot }).find(item => item.pluginId === pluginId)?.status, 'skipped');
  assert.equal(loadBackendPluginsFromDisk({ pluginRoot: userPluginRoot, appVersion: applicationVersion }).length, 0);
  const reinstalled = install();
  assert.equal(reinstalled.status, 'installed', JSON.stringify(reinstalled));
  assertInstalled();
  assert.deepEqual(readLedger(), originalLedger, 'reinstallation must reuse the migration ledger');
  assert.deepEqual(manifest.ownedTables.map(table => tables.get(table)), originalSchema);
} finally {
  db.close();
}

console.log(`[plugin-artifact:${pluginId}] install, toggle, uninstall, seed suppression and reinstall passed in isolated profile`);
