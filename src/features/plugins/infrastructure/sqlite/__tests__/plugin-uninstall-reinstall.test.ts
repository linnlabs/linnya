import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMeta } from '@app/schemas';

import { PluginStateService } from '../plugin-state.service';
import { PluginUpgradeRunner } from '../plugin-upgrade.runner';

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
});
