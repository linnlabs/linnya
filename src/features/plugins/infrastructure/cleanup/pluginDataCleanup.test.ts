import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifestDataStorage } from '@app/schemas';

import {
  calculatePluginStorageUsageAsync,
  cleanupPluginData,
  hasPluginUserData,
  hasPurgedPluginCitationSource,
  markInterruptedPluginDataCleanups,
  readPluginDataSummaryAsync,
} from './pluginDataCleanup';
import { readPluginManifestForCleanup } from './pluginDataManifest';
import { describePluginData } from '../../../../app-hosts/linnya/plugin-registry/pluginDataRoot';
import { uninstallPluginAndDeleteData, uninstallPluginLifecycle } from '../../install/orchestration/uninstallPluginLifecycle';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from '../sqlite/plugin-state.schema';

const storage: PluginManifestDataStorage = {
  legacyRoots: [],
  directories: { source: ['source'], derived: ['derived'], runtime: ['runtime'] },
  userDataTables: ['plugin_owned'],
};
const ownedTables = ['plugin_owned'];

const roots: string[] = [];

function fixture(): { root: string; db: Database.Database; dbPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-cleanup-'));
  roots.push(root);
  const dbPath = path.join(root, 'workspace.sqlite');
  const db = new Database(dbPath);
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
  return { root, db, dbPath };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('plugin data cleanup', () => {
  it('有原件或文档记录才接管；仅旧元数据和索引仍可从未安装态清理', async () => {
    const { root, db } = fixture();
    try {
      const manifestStorage = { ...storage, userDataTables: ['plugin_documents'] };
      const options = { db, dataRoot: root, dataStorage: manifestStorage };
      expect(hasPluginUserData(options)).toBe(true); // 原文存在，文档表尚不存在。
      fs.unlinkSync(path.join(root, 'source', 'payload.bin'));
      expect(hasPluginUserData(options)).toBe(false);
      expect(await readPluginDataSummaryAsync({
        ...options, pluginId: 'demo', ownedTables, pluginInstalled: false, userRemoved: false,
      })).toMatchObject({ status: 'legacy', canDelete: true, tables: { plugin_documents: 0 } });
      db.exec("CREATE TABLE plugin_documents (id TEXT PRIMARY KEY); INSERT INTO plugin_documents VALUES ('doc');");
      expect(hasPluginUserData(options)).toBe(true); // 文档记录存在，原文不在本机。
    } finally { db.close(); }
  });

  it('按实际分配块统计目录并在一个事务中删除目录、表和迁移账本', async () => {
    const { root, db } = fixture();
    const usage = await calculatePluginStorageUsageAsync({ db, dataRoot: root, dataStorage: storage });
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
    const resumed = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(resumed.status).toBe('completed');
    expect(fs.existsSync(path.join(root, 'not-owned'))).toBe(true);
    db.close();
  });

  it('仅在最终清理提交后保留已删除的来源 ID，且不保留资料内容', async () => {
    const { root, db } = fixture();
    try {
      const options = {
        db, pluginId: 'demo', dataRoot: root, ownedTables,
        applicationSurfaceSlot: 'knowledge-base' as const,
        dataStorage: { ...storage, citationSourceTable: 'plugin_owned' },
      };
      // 在最后一条账本写入失败，让删表和来源删除记录一起回滚。
      db.exec(`CREATE TEMP TRIGGER fail_cleanup_commit BEFORE DELETE ON main.plugin_cleanup_jobs
        WHEN OLD.plugin_id = 'demo' BEGIN SELECT RAISE(ABORT, 'Final cleanup commit failed'); END;`);
      expect((await cleanupPluginData(options)).status).toBe('failed');
      expect(hasPurgedPluginCitationSource(db, 'knowledge-base', 'one')).toBe(false);
      expect(db.prepare('SELECT id, value FROM plugin_owned').get()).toEqual({ id: 'one', value: 'kept' });
      db.exec('DROP TRIGGER fail_cleanup_commit');
      expect((await cleanupPluginData(options)).status).toBe('completed');
      expect(hasPurgedPluginCitationSource(db, 'knowledge-base', 'one')).toBe(true);
      expect(hasPurgedPluginCitationSource(db, 'knowledge-base', 'other')).toBe(false);
      expect(db.prepare('SELECT * FROM plugin_purged_citation_sources').all()).toEqual([
        { source_slot: 'knowledge-base', source_id: 'one' },
      ]);
      expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
    } finally { db.close(); }
  });

  it('删除数据选项卸载运行态后清理资料，并保留用户卸载状态', async () => {
    const { root, db } = fixture();
    const options = {
      db,
      userPluginRoot: path.join(root, 'plugins'),
      pluginId: 'demo',
      knownPlugins: [],
      dataRoot: root,
      dataStorage: storage,
      ownedTables,
    };
    const result = await uninstallPluginAndDeleteData(options, () => uninstallPluginLifecycle(options));
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

  it.skipIf(process.platform === 'win32')('matches du for overlapping directories with sparse files and removes unclassified root files', async () => {
    const { root, db } = fixture();
    const qdrantRoot = path.join(root, 'qdrant');
    fs.mkdirSync(path.join(qdrantRoot, 'storage'), { recursive: true });
    fs.mkdirSync(path.join(qdrantRoot, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(qdrantRoot, 'qdrant.lock'), 'runtime');
    fs.writeFileSync(path.join(qdrantRoot, 'storage', 'segment.bin'), 'index');
    fs.truncateSync(path.join(qdrantRoot, 'storage', 'segment.bin'), 64 * 1024 * 1024);
    const qdrantStorage: PluginManifestDataStorage = {
      ...storage,
      directories: {
        source: [],
        derived: ['qdrant/storage'],
        runtime: ['qdrant', 'qdrant/logs'],
      },
    };
    const usage = await calculatePluginStorageUsageAsync({ db, dataRoot: root, dataStorage: qdrantStorage });
    const duBytes = Number(execFileSync('du', ['-sk', qdrantRoot], { encoding: 'utf8' }).split(/\s+/)[0]) * 1024;
    expect(Math.ceil(usage.bytes / 1024) * 1024).toBe(duBytes);
    expect(usage.bytes).toBeLessThan(64 * 1024 * 1024);
    const result = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: qdrantStorage, ownedTables });
    expect(result.status).toBe('completed');
    expect(fs.existsSync(qdrantRoot)).toBe(false);
    db.close();
  });

  it('单个声明目录只删了一项时可以停止，重开数据库后续清', async () => {
    const { root, db, dbPath } = fixture();
    fs.writeFileSync(path.join(root, 'source', 'another.bin'), 'another');
    const controller = new AbortController();
    const originalRemove = fs.promises.unlink;
    const removeSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async target => {
      await originalRemove(target);
      controller.abort();
    });
    const result = await cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: root,
      dataStorage: storage,
      ownedTables,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'interrupted', completedPaths: [] });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(root, 'source'))).toHaveLength(1);
    expect(fs.existsSync(path.join(root, 'derived'))).toBe(true);
    removeSpy.mockRestore();
    db.close();
    const reopened = new Database(dbPath);
    try {
      const resumed = await cleanupPluginData({ db: reopened, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
      expect(resumed.status).toBe('completed');
      expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'derived'))).toBe(false);
      expect(reopened.prepare('SELECT * FROM plugin_cleanup_jobs').all()).toEqual([]);
    } finally { reopened.close(); }
  });

  it.each([
    ['EPERM', 'permission-denied'], ['EACCES', 'permission-denied'], ['EROFS', 'permission-denied'],
    ['EBUSY', 'file-locked'], ['ENOSPC', 'disk-full'],
  ])('删除收到 %s 时记录 %s，恢复后可重试', async (code, errorCode) => {
    const { root, db } = fixture();
    const removeSpy = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(Object.assign(new Error('filesystem error'), { code }));
    const failed = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(failed).toMatchObject({ status: 'failed', errorCode });
    expect(await readPluginDataSummaryAsync({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, pluginInstalled: false, userRemoved: true }))
      .toMatchObject({ status: 'failed', errorCode });
    removeSpy.mockRestore();
    const resumed = await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables });
    expect(resumed.status).toBe('completed');
    vi.restoreAllMocks();
    db.close();
  });

  it('重启只登记中断，不信任旧清理范围；重试只处理本次已授权的目录和表', async () => {
    const { root, db } = fixture();
    db.prepare(`INSERT INTO plugin_cleanup_jobs (plugin_id, status, completed_paths, data_storage, started_at, updated_at)
      VALUES ('demo', 'cleaning', ?, ?, 1, 1)`).run(JSON.stringify(['source:source']), 'old scope');
    markInterruptedPluginDataCleanups(db);
    expect(fs.existsSync(path.join(root, 'source', 'payload.bin'))).toBe(true);
    expect(await readPluginDataSummaryAsync({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, pluginInstalled: false, userRemoved: true }))
      .toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(await cleanupPluginData({ db, pluginId: 'demo', dataRoot: root, dataStorage: storage, ownedTables }))
      .toMatchObject({ status: 'completed' });
    expect(fs.existsSync(path.join(root, 'source'))).toBe(false);
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
    const source = describePluginData({ pluginId: 'demo', workspaceRoot: root, bundledRoot, forCleanup: true, bundledSourceTrusted: true });
    if (!source) throw new Error('expected bundled manifest');
    const dataRoot = path.join(root, 'Plugins', 'demo');
    expect(source.dataRoot).toBe(dataRoot);
    fs.mkdirSync(dataRoot, { recursive: true });
    for (const directory of ['source', 'derived', 'runtime']) {
      fs.renameSync(path.join(root, directory), path.join(dataRoot, directory));
    }
    const result = await cleanupPluginData({
      db,
      pluginId: 'demo',
      dataRoot: source.dataRoot,
      dataStorage: source.manifest.dataStorage,
      ownedTables: source.manifest.ownedTables,
    });
    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(dataRoot, 'source'))).toBe(false);
    db.close();
  });
});
