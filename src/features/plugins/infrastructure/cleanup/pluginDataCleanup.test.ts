import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifestDataStorage } from '@app/schemas';

import {
  calculatePluginStorageUsage,
  cleanupPluginData,
  resumePluginDataCleanup,
} from './pluginDataCleanup';
import { readPluginManifestForCleanup } from './pluginDataManifest';
import { resolvePluginDataRoot } from './pluginDataRoot';
import { uninstallPluginAndDeleteData } from '../../install/orchestration/uninstallPluginLifecycle';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from '../sqlite/plugin-state.schema';

const storage: PluginManifestDataStorage = {
  legacyRoots: [],
  directories: { source: ['source'], derived: ['derived'], runtime: ['runtime'] },
  userDataTables: ['plugin_owned'],
};
const ownedTables = ['plugin_owned'];

const roots: string[] = [];

function fixture(): { root: string; db: Database.Database } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-cleanup-'));
  roots.push(root);
  const db = new Database(':memory:');
  db.exec(`${PLUGIN_PLATFORM_STATE_SCHEMAS.join('\n')}
    CREATE TABLE plugin_owned (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO installed_plugins (plugin_id, version, name, installed_at) VALUES ('demo', '1.0.0', 'Demo', 1);
    INSERT INTO plugin_migrations (plugin_id, version, applied_at) VALUES ('demo', 1, 1);
    INSERT INTO plugin_owned (id, value) VALUES ('one', 'kept');
  `);
  for (const directory of ['source', 'derived', 'runtime']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'payload.bin'), 'payload');
  }
  return { root, db };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('plugin data cleanup', () => {
  it('按实际分配块统计目录并在一个事务中删除目录、表和迁移账本', async () => {
    const { root, db } = fixture();
    const usage = calculatePluginStorageUsage({ db, dataRoot: root, dataStorage: storage });
    expect(usage.bytes).toBeGreaterThanOrEqual(0);
    expect(usage.tables).toEqual({ plugin_owned: 1 });

    const result = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_owned'").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM plugin_migrations WHERE plugin_id = 'demo'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT schema_version FROM installed_plugins WHERE plugin_id = 'demo'").get()).toEqual({ schema_version: 0 });
    db.close();
  });

  it('中断后保留进度，重试会续清且不删除未声明目录', async () => {
    const { root, db } = fixture();
    fs.mkdirSync(path.join(root, 'not-owned'));
    // A cancellation before starting records a resumable failed job.
    const interrupted = new AbortController();
    interrupted.abort();
    const failed = await cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: root,
      dataStorage: storage,
      ownedTables,
      signal: interrupted.signal,
    });
    expect(failed.status).toBe('failed');
    expect(fs.existsSync(path.join(root, 'not-owned'))).toBe(true);
    // 重启后的续清会处理所有声明目录，未声明目录仍然保留。
    const resumed = await resumePluginDataCleanup({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(resumed.status).toBe('completed');
    expect(fs.existsSync(path.join(root, 'not-owned'))).toBe(true);
    db.close();
  });

  it('删除数据选项先完成清理，再写入用户卸载状态', async () => {
    const { root, db } = fixture();
    const result = await uninstallPluginAndDeleteData({
      db,
      userPluginRoot: path.join(root, 'plugins'),
      pluginId: 'demo',
      knownPlugins: [],
      dataRoot: root,
      dataStorage: storage,
      ownedTables,
    });
    expect(result).toMatchObject({ status: 'uninstalled', dataDeleted: true, userDataPreserved: false });
    expect(db.prepare("SELECT installed, user_removed FROM installed_plugins WHERE plugin_id = 'demo'").get()).toEqual({ installed: 0, user_removed: 1 });
    db.close();
  });

  it('只用 userDataTables 判断真实资料，但按 ownedTables 完整清理插件表', async () => {
    const { root, db } = fixture();
    db.exec('CREATE TABLE plugin_metadata (id TEXT PRIMARY KEY); INSERT INTO plugin_metadata VALUES (\'default\');');
    const result = await cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: root,
      dataStorage: { ...storage, userDataTables: ['plugin_owned'] },
      ownedTables: ['plugin_owned', 'plugin_metadata'],
    });
    expect(result.status).toBe('completed');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('plugin_owned', 'plugin_metadata')").all()).toEqual([]);
    db.close();
  });

  it('删除目录中途退出后保留已完成路径，重启可以续清', () => {
    const { root, db } = fixture();
    const controller = new AbortController();
    const originalRemove = fs.rmSync;
    let removeCount = 0;
    const removeSpy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      originalRemove(target, options);
      removeCount += 1;
      if (removeCount === 1) controller.abort();
    });
    const failed = cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: root,
      dataStorage: storage,
      ownedTables,
      signal: controller.signal,
    });
    return failed.then(result => {
      expect(result.status).toBe('failed');
      expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'derived'))).toBe(true);
      removeSpy.mockRestore();
      return resumePluginDataCleanup({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    }).then(result => {
      expect(result.status).toBe('completed');
      expect(fs.existsSync(path.join(root, 'derived'))).toBe(false);
      db.close();
    });
  });

  it('文件权限错误留下可读失败任务，恢复后仍可重试', async () => {
    const { root, db } = fixture();
    const originalRemove = fs.rmSync;
    const removeSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    const failed = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(failed).toMatchObject({ status: 'failed', error: 'permission denied' });
    removeSpy.mockRestore();
    vi.spyOn(fs, 'rmSync').mockImplementation(originalRemove);
    const resumed = await resumePluginDataCleanup({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(resumed.status).toBe('completed');
    vi.restoreAllMocks();
    db.close();
  });

  it('D1: 插件已卸载且没有 direct dir 时，仍从随包 manifest 解析清理声明', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-cleanup-bundled-'));
    roots.push(root);
    const bundledRoot = path.join(root, 'bundled');
    const bundledPluginDir = path.join(bundledRoot, 'demo');
    fs.mkdirSync(bundledPluginDir, { recursive: true });
    fs.writeFileSync(path.join(bundledPluginDir, 'plugin.json'), JSON.stringify({
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo',
      developer: 'Linnya',
      details: ['Demo'],
      entry: { backend: './dist/backend/index.cjs' },
      ownedTables: ['plugin_owned'],
      dataStorage: storage,
    }));

    const source = readPluginManifestForCleanup({
      pluginId: 'demo',
      bundledPluginRoot: bundledRoot,
    });
    expect(source?.kind).toBe('bundled');
    expect(source?.manifest.id).toBe('demo');
    expect(readPluginManifestForCleanup({ pluginId: 'demo' })).toBeNull();
  });

  it('D1: 已卸载插件只能从随包声明解析数据根并完成删除', async () => {
    const { root, db } = fixture();
    const bundledRoot = path.join(root, 'bundled');
    const bundledPluginDir = path.join(bundledRoot, 'demo');
    fs.mkdirSync(bundledPluginDir, { recursive: true });
    fs.writeFileSync(path.join(bundledPluginDir, 'plugin.json'), JSON.stringify({
      id: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'Demo',
      developer: 'Linnya',
      details: ['Demo'],
      entry: { backend: './dist/backend/index.cjs' },
      ownedTables,
      dataStorage: storage,
    }));
    const source = readPluginManifestForCleanup({ pluginId: 'demo', bundledPluginRoot: bundledRoot });
    if (!source) throw new Error('expected bundled manifest');
    const dataRoot = resolvePluginDataRoot({
      workspaceRoot: path.dirname(root),
      pluginId: 'demo',
      dataStorage: source.manifest.dataStorage,
      allowLegacyRoots: true,
    });
    expect(dataRoot).toBe(path.join(path.dirname(root), 'Plugins', 'demo'));
    const result = await cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: root,
      dataStorage: source.manifest.dataStorage,
      ownedTables: source.manifest.ownedTables,
    });
    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
    db.close();
  });
});
