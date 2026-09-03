import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PluginActiveVersionService } from '../../../infrastructure/sqlite/plugin-active-version.service';
import { readActivePluginPointer } from '../activatePluginVersion';
import { reconcilePluginActiveVersions } from '../reconcilePluginActiveVersions';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-active-reconcile-'));
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

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      installed INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      required INTEGER NOT NULL DEFAULT 0,
      installed_at INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO installed_plugins (plugin_id, version, name, installed, installed_at)
    VALUES ('demo', '1.1.0', 'Demo', 1, 123);
  `);
  return db;
}

describe('reconcilePluginActiveVersions', () => {
  let db: Database.Database;
  let userPluginRoot: string;

  beforeEach(() => {
    db = createDb();
    userPluginRoot = path.join(makeTempRoot(), 'plugins');
    writePluginVersion(userPluginRoot, '1.0.0');
    writePluginVersion(userPluginRoot, '1.1.0');
  });

  afterEach(() => {
    db.close();
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('启动时用 activating 记录修复 active.json 写失败留下的旧指针', () => {
    writeJson(path.join(userPluginRoot, 'demo/active.json'), { version: '1.0.0' });
    new PluginActiveVersionService(db).markActivating({
      pluginId: 'demo',
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
    });

    expect(reconcilePluginActiveVersions({ db, userPluginRoot })).toEqual([{
      pluginId: 'demo',
      version: '1.1.0',
      status: 'synced',
    }]);
    expect(readActivePluginPointer(userPluginRoot, 'demo')).toEqual({
      version: '1.1.0',
      previousVersion: '1.0.0',
    });
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
      status: 'active',
      error: null,
    });
  });

  it('已成功激活的新版本若被加载失败回滚到 previous，启动时承认运行时回滚事实', () => {
    writeJson(path.join(userPluginRoot, 'demo/active.json'), { version: '1.0.0' });
    new PluginActiveVersionService(db).markActive({
      pluginId: 'demo',
      activeVersion: '1.1.0',
      previousVersion: '1.0.0',
    });

    expect(reconcilePluginActiveVersions({ db, userPluginRoot })).toEqual([{
      pluginId: 'demo',
      version: '1.0.0',
      status: 'rollback-adopted',
    }]);
    expect(new PluginActiveVersionService(db).getRecord('demo')).toMatchObject({
      activeVersion: '1.0.0',
      previousVersion: null,
      status: 'active',
      error: null,
    });
  });
});
