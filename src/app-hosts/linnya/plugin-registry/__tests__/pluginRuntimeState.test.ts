import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginRuntimeDatabaseForTests,
  clearPluginRuntimeStateForTests,
  getPluginRuntimeState,
  getRuntimeEnabledPluginIds,
  isPluginRuntimeEnabled,
  PluginRuntimeDatabaseNotReadyError,
  PluginRuntimeDatabaseQueryError,
  setPluginRuntimeDatabase,
  setPluginRuntimeStateForTests,
} from '../pluginRuntimeState';

function createPluginStateDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE installed_plugins (
      plugin_id TEXT PRIMARY KEY,
      installed INTEGER NOT NULL
    );

    CREATE TABLE enabled_plugins (
      plugin_id TEXT PRIMARY KEY,
      enabled_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('pluginRuntimeState', () => {
  const pluginId = 'runtime-state-fixture';
  afterEach(() => {
    clearPluginRuntimeStateForTests();
    clearPluginRuntimeDatabaseForTests();
  });

  it('未注入数据库时 fail-fast，避免把启动顺序问题伪装成插件未安装', () => {
    expect(() => getPluginRuntimeState(pluginId)).toThrow(PluginRuntimeDatabaseNotReadyError);
    expect(() => isPluginRuntimeEnabled(pluginId)).toThrow(PluginRuntimeDatabaseNotReadyError);
    expect(() => getRuntimeEnabledPluginIds()).toThrow(PluginRuntimeDatabaseNotReadyError);
  });

  it('每次从数据库读取安装/启用三态，不依赖内存快照', () => {
    const db = createPluginStateDb();
    setPluginRuntimeDatabase(db);

    db.prepare('INSERT INTO installed_plugins (plugin_id, installed) VALUES (?, ?)').run('platform', 1);
    db.prepare('INSERT INTO installed_plugins (plugin_id, installed) VALUES (?, ?)').run(pluginId, 1);
    db.prepare('INSERT INTO enabled_plugins (plugin_id, enabled_at) VALUES (?, ?)').run('platform', 1);

    expect(getPluginRuntimeState('platform')).toBe('enabled');
    expect(getPluginRuntimeState(pluginId)).toBe('disabled');
    expect(getRuntimeEnabledPluginIds()).toEqual(new Set(['platform']));

    db.prepare('INSERT INTO enabled_plugins (plugin_id, enabled_at) VALUES (?, ?)').run(pluginId, 2);

    expect(getPluginRuntimeState(pluginId)).toBe('enabled');
    expect(getRuntimeEnabledPluginIds()).toEqual(new Set(['platform', pluginId]));

    db.prepare('UPDATE installed_plugins SET installed = 0 WHERE plugin_id = ?').run(pluginId);

    expect(getPluginRuntimeState(pluginId)).toBe('missing');
    expect(getRuntimeEnabledPluginIds()).toEqual(new Set(['platform']));

    db.close();
  });

  it('测试覆盖可以显式表达 installed/enabled 差异', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform'],
    });

    expect(getPluginRuntimeState('platform')).toBe('enabled');
    expect(getPluginRuntimeState(pluginId)).toBe('disabled');
    expect(getPluginRuntimeState('unknown-plugin')).toBe('missing');
  });

  it('数据库查询失败时抛出诊断错误，不折叠成 missing', () => {
    const db = new Database(':memory:');
    setPluginRuntimeDatabase(db);

    expect(() => getPluginRuntimeState(pluginId)).toThrow(PluginRuntimeDatabaseQueryError);
    expect(() => getRuntimeEnabledPluginIds()).toThrow(PluginRuntimeDatabaseQueryError);

    db.close();
  });

  it('同一进程内不允许用另一个 Database 实例覆盖插件运行态数据库', () => {
    const firstDb = createPluginStateDb();
    const secondDb = createPluginStateDb();
    setPluginRuntimeDatabase(firstDb);

    expect(() => setPluginRuntimeDatabase(firstDb)).not.toThrow();
    expect(() => setPluginRuntimeDatabase(secondDb)).toThrow('不能被另一个 Database 实例覆盖');

    firstDb.close();
    secondDb.close();
  });
});
