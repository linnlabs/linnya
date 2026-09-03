import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';

import { PluginMigrationRunner } from '../plugin-migration.runner';

interface TableRow {
  name: string;
}

interface InstalledPluginRow {
  schema_version: number;
}

function createPluginMigrationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      version TEXT NOT NULL DEFAULT '1.0.0',
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

    CREATE TABLE plugin_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, version)
    );
  `);
}

function insertInstalledPlugin(db: Database.Database, schemaVersion = 0): void {
  db.prepare(`
    INSERT INTO installed_plugins
      (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, source)
    VALUES ('demo', '1.0.0', 'Demo', 1, 1, 0, 123, ?, 'builtin')
  `).run(schemaVersion);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as TableRow | undefined;
  return !!row;
}

function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT schema_version FROM installed_plugins WHERE plugin_id = 'demo'")
    .get() as InstalledPluginRow;
  return row.schema_version;
}

function readAppliedVersions(db: Database.Database): number[] {
  const rows = db
    .prepare("SELECT version FROM plugin_migrations WHERE plugin_id = 'demo' ORDER BY version")
    .all() as Array<{ version: number }>;
  return rows.map((row) => row.version);
}

describe('PluginMigrationRunner', () => {
  let db: Database.Database;
  let runner: PluginMigrationRunner;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginMigrationTables(db);
    runner = new PluginMigrationRunner(db);
  });

  afterEach(() => {
    db.close();
  });

  it('从空 schema 版本跑到已声明的最新迁移', () => {
    insertInstalledPlugin(db);

    const result = runner.run('demo', [
      {
        version: 1,
        description: 'create first table',
        up: (migrationDb) => {
          migrationDb.exec('CREATE TABLE demo_first (id TEXT PRIMARY KEY)');
        },
      },
      {
        version: 2,
        description: 'create second table',
        up: (migrationDb) => {
          migrationDb.exec('CREATE TABLE demo_second (id TEXT PRIMARY KEY)');
        },
      },
    ]);

    expect(result).toEqual({
      pluginId: 'demo',
      fromVersion: 0,
      toVersion: 2,
      appliedVersions: [1, 2],
    });
    expect(tableExists(db, 'demo_first')).toBe(true);
    expect(tableExists(db, 'demo_second')).toBe(true);
    expect(readAppliedVersions(db)).toEqual([1, 2]);
    expect(readSchemaVersion(db)).toBe(2);
  });

  it('只补跑当前版本之后的迁移', () => {
    insertInstalledPlugin(db, 1);
    db.prepare("INSERT INTO plugin_migrations (plugin_id, version, applied_at) VALUES ('demo', 1, 111)").run();

    const result = runner.run('demo', [
      {
        version: 1,
        description: 'already applied',
        up: (migrationDb) => {
          migrationDb.exec('CREATE TABLE should_not_exist (id TEXT PRIMARY KEY)');
        },
      },
      {
        version: 2,
        description: 'pending',
        up: (migrationDb) => {
          migrationDb.exec('CREATE TABLE demo_pending (id TEXT PRIMARY KEY)');
        },
      },
    ]);

    expect(result).toEqual({
      pluginId: 'demo',
      fromVersion: 1,
      toVersion: 2,
      appliedVersions: [2],
    });
    expect(tableExists(db, 'should_not_exist')).toBe(false);
    expect(tableExists(db, 'demo_pending')).toBe(true);
    expect(readAppliedVersions(db)).toEqual([1, 2]);
    expect(readSchemaVersion(db)).toBe(2);
  });

  it('任一 pending 迁移失败时回滚整批账本和已经执行的 DDL', () => {
    insertInstalledPlugin(db);
    const migrations: readonly PluginMigrationDefinition[] = [
      {
        version: 1,
        description: 'create table before failure',
        up: (migrationDb) => {
          migrationDb.exec('CREATE TABLE rolled_back_table (id TEXT PRIMARY KEY)');
        },
      },
      {
        version: 2,
        description: 'fail after first migration',
        up: () => {
          throw new Error('boom');
        },
      },
    ];

    expect(() => runner.run('demo', migrations)).toThrow('boom');
    expect(tableExists(db, 'rolled_back_table')).toBe(false);
    expect(readAppliedVersions(db)).toEqual([]);
    expect(readSchemaVersion(db)).toBe(0);
  });

  it('拒绝用旧代码打开更新的插件 schema 账本', () => {
    insertInstalledPlugin(db, 3);

    expect(() =>
      runner.run('demo', [
        {
          version: 1,
          description: 'old code latest migration',
          up: (migrationDb) => {
            migrationDb.exec('CREATE TABLE should_not_run (id TEXT PRIMARY KEY)');
          },
        },
      ]),
    ).toThrow('高于当前代码声明');
    expect(tableExists(db, 'should_not_run')).toBe(false);
    expect(readSchemaVersion(db)).toBe(3);
  });
});
