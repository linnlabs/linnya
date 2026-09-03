import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { readPluginRuntimeEnabled } from './readPluginRuntimeEnabled';

describe('readPluginRuntimeEnabled', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  async function createDatabase(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-runtime-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE installed_plugins (plugin_id TEXT PRIMARY KEY, installed INTEGER NOT NULL);
      CREATE TABLE enabled_plugins (plugin_id TEXT PRIMARY KEY);
    `);
    database.close();
    return databasePath;
  }

  it('只在插件已安装且启用时返回 true', async () => {
    const databasePath = await createDatabase();
    const database = new Database(databasePath);
    database.prepare('INSERT INTO installed_plugins (plugin_id, installed) VALUES (?, 1)').run('slides');
    database.prepare('INSERT INTO enabled_plugins (plugin_id) VALUES (?)').run('slides');
    database.close();

    expect(readPluginRuntimeEnabled({ databasePath, pluginId: 'slides' })).toBe(true);
  });

  it('对 disabled、missing、损坏或不存在的数据库 fail closed', async () => {
    const disabledPath = await createDatabase();
    const disabledDatabase = new Database(disabledPath);
    disabledDatabase.prepare('INSERT INTO installed_plugins (plugin_id, installed) VALUES (?, 1)').run('slides');
    disabledDatabase.close();

    const missingPluginPath = await createDatabase();
    const missingPluginDatabase = new Database(missingPluginPath);
    missingPluginDatabase.prepare('INSERT INTO enabled_plugins (plugin_id) VALUES (?)').run('slides');
    missingPluginDatabase.close();

    const malformedPath = await createDatabase();
    const malformedDatabase = new Database(malformedPath);
    malformedDatabase.exec('DROP TABLE installed_plugins');
    malformedDatabase.close();

    expect(readPluginRuntimeEnabled({ databasePath: disabledPath, pluginId: 'slides' })).toBe(false);
    expect(readPluginRuntimeEnabled({ databasePath: missingPluginPath, pluginId: 'slides' })).toBe(false);
    expect(readPluginRuntimeEnabled({ databasePath: malformedPath, pluginId: 'slides' })).toBe(false);
    expect(readPluginRuntimeEnabled({
      databasePath: path.join(path.dirname(disabledPath), 'missing.sqlite'),
      pluginId: 'slides',
    })).toBe(false);
  });
});
