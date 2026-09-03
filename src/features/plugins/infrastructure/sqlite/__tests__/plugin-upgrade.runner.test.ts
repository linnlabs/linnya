import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginUpgradeDiagnostic } from '../plugin-upgrade.runner';

import { PluginUpgradeRunner } from '../plugin-upgrade.runner';

interface ColumnRow {
  name: string;
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

function seedInstalledPlugin(db: Database.Database): void {
  db.exec(`
    INSERT INTO installed_plugins
      (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, source)
    VALUES ('demo', '1.0.0', 'Demo', 1, 1, 0, 123, 1, 'builtin');

    INSERT INTO plugin_migrations (plugin_id, version, applied_at)
    VALUES ('demo', 1, 123);

    INSERT INTO plugin_owned (id, value)
    VALUES ('row-1', 'before');
  `);
}

function seedInstalledPluginWithoutOwnedTable(db: Database.Database): void {
  db.exec(`
    DELETE FROM plugin_owned;
    DROP TABLE plugin_owned;
    DELETE FROM plugin_migrations WHERE plugin_id = 'demo';
    UPDATE installed_plugins
    SET version = '0.0.0',
        schema_version = 0
    WHERE plugin_id = 'demo';
  `);
}

function readInstalledState(db: Database.Database): { version: string; schema_version: number } {
  return db
    .prepare("SELECT version, schema_version FROM installed_plugins WHERE plugin_id = 'demo'")
    .get() as { version: string; schema_version: number };
}

function readMigrationVersions(db: Database.Database): number[] {
  const rows = db
    .prepare("SELECT version FROM plugin_migrations WHERE plugin_id = 'demo' ORDER BY version")
    .all() as Array<{ version: number }>;
  return rows.map((row) => row.version);
}

function readColumnNames(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as ColumnRow[];
  return rows.map((row) => row.name);
}

describe('PluginUpgradeRunner', () => {
  let db: Database.Database;
  let diagnostics: PluginUpgradeDiagnostic[];
  let runner: PluginUpgradeRunner;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    seedInstalledPlugin(db);
    diagnostics = [];
    runner = new PluginUpgradeRunner(db, {
      appVersion: '0.0.36',
      recordDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('版本落后时在同一事务内跑 pending migration 并更新版本号', () => {
    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.1.0',
      compatMin: '0.0.36',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 1,
          description: 'already applied',
          up: (migrationDb) => {
            migrationDb.exec('CREATE TABLE should_not_run (id TEXT PRIMARY KEY)');
          },
        },
        {
          version: 2,
          description: 'add owned metadata',
          up: (migrationDb) => {
            migrationDb.exec('ALTER TABLE plugin_owned ADD COLUMN note TEXT;');
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'upgraded',
      pluginId: 'demo',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.1.0', schema_version: 2 });
    expect(readMigrationVersions(db)).toEqual([1, 2]);
    expect(readColumnNames(db, 'plugin_owned')).toEqual(['id', 'value', 'note']);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('第二条 pending migration 失败时回滚 schema、数据、版本号和迁移账本', () => {
    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.1.0',
      compatMin: '0.0.36',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 1,
          description: 'already applied',
          up: () => {},
        },
        {
          version: 2,
          description: 'mutate schema and data',
          up: (migrationDb) => {
            migrationDb.exec('ALTER TABLE plugin_owned ADD COLUMN note TEXT;');
            migrationDb.exec("UPDATE plugin_owned SET value = 'during-upgrade' WHERE id = 'row-1';");
          },
        },
        {
          version: 3,
          description: 'fail',
          up: () => {
            throw new Error('planned failure');
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'demo',
      fromVersion: '1.0.0',
      targetVersion: '1.1.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
    expect(readMigrationVersions(db)).toEqual([1]);
    expect(readColumnNames(db, 'plugin_owned')).toEqual(['id', 'value']);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('planned failure');
  });

  it('应用版本低于 compat.minApp 时跳过升级并记录诊断', () => {
    runner = new PluginUpgradeRunner(db, {
      appVersion: '0.0.35',
      recordDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });

    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.1.0',
      compatMin: '0.0.36',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 2,
          description: 'pending',
          up: (migrationDb) => {
            migrationDb.exec('ALTER TABLE plugin_owned ADD COLUMN note TEXT;');
          },
        },
      ],
    });

    expect(result.status).toBe('incompatible');
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
    expect(readColumnNames(db, 'plugin_owned')).toEqual(['id', 'value']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('低于插件最低要求');
  });

  it('数据库 schema 版本高于当前声明时记录诊断而不是抛出', () => {
    db.prepare("UPDATE installed_plugins SET schema_version = 3 WHERE plugin_id = 'demo'").run();

    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.0.0',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 1,
          description: 'known migration',
          up: () => {},
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('高于当前代码声明');
  });

  it('ownedTables 声明和真实表结构漂移时升级失败并记录诊断', () => {
    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.1.0',
      ownedTables: ['plugin_owned', 'missing_owned'],
      migrations: [
        {
          version: 1,
          description: 'already applied',
          up: () => {},
        },
        {
          version: 2,
          description: 'would mutate table',
          up: (migrationDb) => {
            migrationDb.exec("UPDATE plugin_owned SET value = 'should-not-run' WHERE id = 'row-1';");
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'demo',
      fromVersion: '1.0.0',
      targetVersion: '1.1.0',
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('插件 ownedTables 迁移后仍缺表: demo/missing_owned');
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
    expect(readMigrationVersions(db)).toEqual([1]);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
  });

  it('pending migration 可以创建新版 ownedTables，不会被升级前快照误判为漂移', () => {
    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.1.0',
      ownedTables: ['plugin_owned', 'plugin_new_owned'],
      migrations: [
        {
          version: 1,
          description: 'already applied',
          up: () => {},
        },
        {
          version: 2,
          description: 'create new owned table',
          up: (migrationDb) => {
            migrationDb.exec(`
              CREATE TABLE plugin_new_owned (
                id TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );
              INSERT INTO plugin_new_owned (id, value) VALUES ('new-1', 'after');
            `);
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'upgraded',
      pluginId: 'demo',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.1.0', schema_version: 2 });
    expect(readMigrationVersions(db)).toEqual([1, 2]);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
    expect(db.prepare('SELECT id, value FROM plugin_new_owned').all()).toEqual([
      { id: 'new-1', value: 'after' },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('schema v0 首次基线迁移可创建 ownedTables，不提前做数据快照', () => {
    seedInstalledPluginWithoutOwnedTable(db);

    const result = runner.run({
      pluginId: 'demo',
      targetVersion: '1.0.0',
      ownedTables: ['plugin_owned'],
      migrations: [
        {
          version: 1,
          description: 'create owned baseline table',
          up: (migrationDb) => {
            migrationDb.exec(`
              CREATE TABLE plugin_owned (
                id TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );
              INSERT INTO plugin_owned (id, value) VALUES ('row-1', 'baseline');
            `);
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'upgraded',
      pluginId: 'demo',
      fromVersion: '0.0.0',
      toVersion: '1.0.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
    expect(readMigrationVersions(db)).toEqual([1]);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'baseline' },
    ]);
    expect(diagnostics).toEqual([]);
  });
});
