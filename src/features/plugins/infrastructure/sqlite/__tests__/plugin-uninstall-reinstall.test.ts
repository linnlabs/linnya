import Database from 'better-sqlite3';
import fs from 'node:fs';
import { hash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from '../plugin-state.service';
import { PluginActiveVersionService } from '../plugin-active-version.service';
import { PluginUpgradeRunner } from '../plugin-upgrade.runner';
import { installPluginFromBundledAndActivate } from '../../../install/orchestration/installPluginFromBundledAndActivate';
import { reconcilePluginActiveVersions } from '../../../install/orchestration/reconcilePluginActiveVersions';
import { markPluginUserRemoved, isPluginUserRemoved } from '../../../install/functions/pluginRemovalMarker';
import { stageBundledPluginForExplicitInstall } from '../../../../../electron-main/plugins/loader/pluginRuntimeBootstrap';

const platformMeta: PluginMeta = {
  id: 'platform',
  name: 'Platform',
  version: '1.0.0',
  description: 'Core',
  developer: 'Linnya',
  builtin: true,
  required: true,
};

const demoMeta: PluginMeta = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'Demo plugin',
  developer: 'Linnya',
  builtin: true,
  dependsOn: ['platform'],
};

function writeFixtureChecksums(directory: string): void {
  const entry = 'dist/renderer/index.js';
  fs.mkdirSync(path.join(directory, 'dist/renderer'), { recursive: true });
  fs.writeFileSync(path.join(directory, entry), 'export {};');
  fs.writeFileSync(path.join(directory, 'SHA512SUMS'), ['plugin.json', entry]
    .map(file => `${hash('sha512', fs.readFileSync(path.join(directory, file)))}  ${file}\n`).join(''));
}

function createPluginTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 1,
      required INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      compat_min TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      user_removed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE enabled_plugins (
      plugin_id TEXT PRIMARY KEY,
      enabled_at INTEGER NOT NULL,
      FOREIGN KEY(plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
    );

    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );

    CREATE TABLE plugin_owned (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

describe('plugin uninstall/reinstall data safety', () => {
  let db: Database.Database;
  let stateService: PluginStateService;
  let upgradeRunner: PluginUpgradeRunner;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    stateService = new PluginStateService(db);
    stateService.ensureBuiltinInstalled([platformMeta, demoMeta]);
    db.exec(`
      UPDATE installed_plugins SET schema_version = 1 WHERE plugin_id = 'demo';
      INSERT INTO plugin_migrations (plugin_id, version, applied_at) VALUES ('demo', 1, 123);
      INSERT INTO plugin_owned (id, value) VALUES ('row-1', 'kept');
    `);
    upgradeRunner = new PluginUpgradeRunner(db, { appVersion: '0.0.36' });
  });

  afterEach(() => {
    db.close();
  });

  it('卸载只移除可见性，重装后数据和迁移账本仍可用', () => {
    stateService.setInstalled('demo', false, [platformMeta, demoMeta]);

    expect(stateService.getInstalledRecord('demo')).toMatchObject({ installed: false });
    expect(db.prepare("SELECT plugin_id FROM enabled_plugins WHERE plugin_id = 'demo'").all()).toEqual([]);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([{ id: 'row-1', value: 'kept' }]);
    expect(db.prepare("SELECT version FROM plugin_migrations WHERE plugin_id = 'demo'").all()).toEqual([
      { version: 1 },
    ]);

    stateService.setInstalled('demo', true, [platformMeta, demoMeta]);
    const result = upgradeRunner.run({
      pluginId: 'demo',
      targetVersion: '1.0.0',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 1,
          description: 'already applied',
          up: (migrationDb) => {
            migrationDb.exec('CREATE TABLE should_not_run (id TEXT PRIMARY KEY)');
          },
        },
      ],
    });

    expect(result).toMatchObject({ status: 'skipped', reason: 'current' });
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([{ id: 'row-1', value: 'kept' }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM plugin_migrations WHERE plugin_id = 'demo'").get()).toEqual({
      count: 1,
    });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_run'").all(),
    ).toEqual([]);
  });

  it('显式从随包重装会绕过卸载标记、默认启用并复用旧数据', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-bundled-reinstall-'));
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    const sourceDir = path.join(bundledRoot, 'demo');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'plugin.json'), `${JSON.stringify({
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      developer: 'Linnya',
      details: ['Demo'],
      entry: { renderer: './dist/renderer/index.js' },
      compat: { rendererUi: '^1.0.0' },
    })}\n`);
    writeFixtureChecksums(sourceDir);
    fs.mkdirSync(userPluginRoot, { recursive: true });

    stateService.setInstalled('demo', false, [platformMeta, demoMeta]);
    stateService.setUserRemoved('demo', true);
    markPluginUserRemoved(userPluginRoot, 'demo');

    const result = installPluginFromBundledAndActivate({
      db,
      userPluginRoot,
      pluginId: 'demo',
      appVersion: '0.0.36',
      knownPlugins: [platformMeta, demoMeta],
      stageBundledPlugin: () => stageBundledPluginForExplicitInstall({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
        pluginId: 'demo',
      }),
      resolveUpgradePlan: ({ pluginId, version }) => ({
        pluginId,
        targetVersion: version,
        ownedTables: ['plugin_owned'],
        migrations: [{
          version: 1,
          description: 'already applied',
          up: () => {},
        }],
      }),
    });

    expect(result).toMatchObject({
      status: 'installed',
      pluginId: 'demo',
      version: '1.0.0',
      previousVersion: null,
      restartRequired: false,
    });
    expect(stateService.getInstalledRecord('demo')).toMatchObject({
      installed: true,
      userRemoved: false,
    });
    expect(db.prepare("SELECT plugin_id FROM enabled_plugins WHERE plugin_id = 'demo'").all()).toEqual([
      { plugin_id: 'demo' },
    ]);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([{ id: 'row-1', value: 'kept' }]);
    expect(isPluginUserRemoved(userPluginRoot, 'demo')).toBe(false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('重装提交前回滚；提交后指针写失败则保留产物，启动续做激活', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-bundled-reinstall-failure-'));
    const bundledRoot = path.join(tempRoot, 'bundled');
    const userPluginRoot = path.join(tempRoot, 'user-plugins');
    const sourceDir = path.join(bundledRoot, 'demo');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'plugin.json'), `${JSON.stringify({
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo plugin',
      developer: 'Linnya',
      details: ['Demo'],
      entry: { renderer: './dist/renderer/index.js' },
      compat: { rendererUi: '^1.0.0' },
    })}\n`);
    writeFixtureChecksums(sourceDir);
    fs.mkdirSync(userPluginRoot, { recursive: true });
    stateService.setInstalled('demo', false, [platformMeta, demoMeta]);
    stateService.setUserRemoved('demo', true);
    markPluginUserRemoved(userPluginRoot, 'demo');

    let shouldFail = true;
    const install = () => installPluginFromBundledAndActivate({
      db,
      userPluginRoot,
      pluginId: 'demo',
      appVersion: '0.0.36',
      knownPlugins: [platformMeta, demoMeta],
      stageBundledPlugin: () => stageBundledPluginForExplicitInstall({
        bundledPluginRoot: bundledRoot,
        userPluginRoot,
        pluginId: 'demo',
      }),
      resolveUpgradePlan: ({ pluginId, version }) => {
        if (shouldFail) {
          throw new Error('test migration planning failure');
        }
        return {
          pluginId,
          targetVersion: version,
          ownedTables: ['plugin_owned'],
          migrations: [{
            version: 1,
            description: 'already applied',
            up: () => {},
          }],
        };
      },
    });

    const result = install();
    expect(result).toMatchObject({ status: 'failed', pluginId: 'demo', version: '1.0.0' });
    expect(stateService.getInstalledRecord('demo')).toMatchObject({
      installed: false,
      userRemoved: true,
    });
    expect(isPluginUserRemoved(userPluginRoot, 'demo')).toBe(true);
    expect(fs.existsSync(path.join(userPluginRoot, 'demo/active.json'))).toBe(false);
    expect(fs.existsSync(path.join(userPluginRoot, 'demo/1.0.0'))).toBe(false);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([{ id: 'row-1', value: 'kept' }]);

    shouldFail = false;
    const rename = fs.renameSync;
    const writePointerError = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === path.join(userPluginRoot, 'demo/active.json')) throw new Error('fixture: active pointer write interrupted');
      return rename(from, to);
    });
    const retryResult = (() => {
      try { return install(); }
      finally { writePointerError.mockRestore(); }
    })();
    expect(retryResult).toMatchObject({
      status: 'installed',
      pluginId: 'demo',
      version: '1.0.0',
      restartRequired: true,
    });
    expect(stateService.getInstalledRecord('demo')).toMatchObject({ installed: true, userRemoved: false, schemaVersion: 1 });
    expect(isPluginUserRemoved(userPluginRoot, 'demo')).toBe(true);
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({ status: 'failed', activeVersion: '1.0.0' });
    expect(fs.existsSync(path.join(userPluginRoot, 'demo/1.0.0/plugin.json'))).toBe(true);
    expect(reconcilePluginActiveVersions({ db, userPluginRoot })).toMatchObject([{ status: 'synced' }]);
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({ status: 'active', activeVersion: '1.0.0' });
    expect(isPluginUserRemoved(userPluginRoot, 'demo')).toBe(false);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([{ id: 'row-1', value: 'kept' }]);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
