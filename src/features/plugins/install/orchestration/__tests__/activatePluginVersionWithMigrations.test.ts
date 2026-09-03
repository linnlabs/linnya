import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readActivePluginPointer } from '../activatePluginVersion';
import { activatePluginVersionWithMigrations } from '../activatePluginVersionWithMigrations';
import { PluginActiveVersionService } from '../../../infrastructure/sqlite/plugin-active-version.service';

interface ColumnRow {
  name: string;
}

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-activate-migrate-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePluginVersion(userPluginRoot: string, version: string): void {
  writeJson(path.join(userPluginRoot, 'demo', version, 'plugin.json'), {
    id: 'demo',
    version,
    name: 'Demo',
    description: 'Demo plugin',
    developer: 'Linnya',
    details: ['Demo plugin details'],
    entry: {
      backend: './dist/backend/index.cjs',
    },
  });
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
      source TEXT NOT NULL DEFAULT 'remote',
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

    INSERT INTO installed_plugins
      (plugin_id, version, name, installed, builtin, required, installed_at, schema_version, source)
    VALUES ('demo', '1.0.0', 'Demo', 1, 0, 0, 123, 1, 'remote');

    INSERT INTO plugin_migrations (plugin_id, version, applied_at)
    VALUES ('demo', 1, 123);

    INSERT INTO plugin_owned (id, value)
    VALUES ('row-1', 'before');
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

describe('activatePluginVersionWithMigrations', () => {
  let db: Database.Database;
  let userPluginRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    createPluginTables(db);
    userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writePluginVersion(userPluginRoot, '1.1.0');
    writeJson(path.join(userPluginRoot, 'demo/active.json'), { version: '1.0.0' });
  });

  afterEach(() => {
    db.close();
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('激活新版本时先跑插件迁移，成功后 active 与数据库版本一起前进', () => {
    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: 'demo',
      version: '1.1.0',
      appVersion: '0.0.36',
      upgradePlan: {
        pluginId: 'demo',
        targetVersion: '1.1.0',
        ownedTables: ['plugin_owned'],
        migrations: [
          {
            version: 1,
            description: 'already applied',
            up: () => {},
          },
          {
            version: 2,
            description: 'add note column',
            up: (migrationDb) => {
              migrationDb.exec('ALTER TABLE plugin_owned ADD COLUMN note TEXT;');
              migrationDb.exec("UPDATE plugin_owned SET value = 'after', note = 'migrated' WHERE id = 'row-1';");
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: 'activated',
      pluginId: 'demo',
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.1.0', schema_version: 2 });
    expect(readMigrationVersions(db)).toEqual([1, 2]);
    expect(readColumnNames(db, 'plugin_owned')).toEqual(['id', 'value', 'note']);
    expect(db.prepare('SELECT id, value, note FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'after', note: 'migrated' },
    ]);
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({
      pluginId: 'demo',
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
      status: 'active',
      error: null,
    });
  });

  it('插件迁移失败时回滚数据和版本账本，active 指针保持旧版本不变', () => {
    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: 'demo',
      version: '1.1.0',
      appVersion: '0.0.36',
      upgradePlan: {
        pluginId: 'demo',
        targetVersion: '1.1.0',
        ownedTables: ['plugin_owned'],
        migrations: [
          {
            version: 1,
            description: 'already applied',
            up: () => {},
          },
          {
            version: 2,
            description: 'mutate table',
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
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'demo',
      version: '1.1.0',
    });
    if (result.status !== 'failed') {
      throw new Error('expected activation to fail');
    }
    expect(result.error).toContain('planned failure');
    expect(result).not.toHaveProperty('rollbackResult');
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.0.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
    expect(readMigrationVersions(db)).toEqual([1]);
    expect(readColumnNames(db, 'plugin_owned')).toEqual(['id', 'value']);
    expect(db.prepare('SELECT id, value FROM plugin_owned').all()).toEqual([
      { id: 'row-1', value: 'before' },
    ]);
  });

  it('迁移失败时不会留下指向新版本的 active 崩溃窗口', () => {
    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: 'demo',
      version: '1.1.0',
      appVersion: '0.0.36',
      upgradePlan: {
        pluginId: 'demo',
        targetVersion: '1.1.0',
        ownedTables: ['plugin_owned'],
        migrations: [
          {
            version: 1,
            description: 'already applied',
            up: () => {},
          },
          {
            version: 2,
            description: 'fail before activation',
            up: () => {
              throw new Error('migration stops before active switch');
            },
          },
        ],
      },
    });

    expect(result.status).toBe('failed');
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.0.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.0.0', schema_version: 1 });
  });

  it('迁移期间 active 指针变化时拒绝覆盖，保留当前 active', () => {
    writePluginVersion(userPluginRoot, '1.2.0');
    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: 'demo',
      version: '1.1.0',
      appVersion: '0.0.36',
      upgradePlan: {
        pluginId: 'demo',
        targetVersion: '1.1.0',
        ownedTables: ['plugin_owned'],
        migrations: [
          {
            version: 1,
            description: 'already applied',
            up: () => {},
          },
          {
            version: 2,
            description: 'simulate competing activation',
            up: () => {
              writeJson(path.join(userPluginRoot, 'demo/active.json'), { version: '1.2.0' });
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'demo',
      version: '1.1.0',
    });
    if (result.status !== 'failed') {
      throw new Error('expected activation to fail');
    }
    expect(result.error).toContain('previousVersion changed during activation');
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.2.0',
    });
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({
      pluginId: 'demo',
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
      status: 'failed',
    });
  });

  it('迁移提交后 active 写失败时保留可启动修复的运行时账本', () => {
    const result = activatePluginVersionWithMigrations({
      db,
      userPluginRoot,
      pluginId: 'demo',
      version: '1.1.0',
      appVersion: '0.0.36',
      upgradePlan: {
        pluginId: 'demo',
        targetVersion: '1.1.0',
        ownedTables: ['plugin_owned'],
        migrations: [
          {
            version: 1,
            description: 'already applied',
            up: () => {},
          },
          {
            version: 2,
            description: 'remove target artifact before active switch',
            up: () => {
              fs.rmSync(path.join(userPluginRoot, 'demo/1.1.0'), { recursive: true, force: true });
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      pluginId: 'demo',
      version: '1.1.0',
    });
    if (result.status !== 'failed') {
      throw new Error('expected activation to fail');
    }
    expect(result.error).toContain('缺少 plugin.json');
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.0.0',
    });
    expect(readInstalledState(db)).toEqual({ version: '1.1.0', schema_version: 2 });
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({
      pluginId: 'demo',
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
      status: 'failed',
    });
  });
});
