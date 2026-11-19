import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { PluginManifestDataStorageSchema, type PluginId, type PluginManifestDataStorage } from '@app/schemas';

import { PLUGIN_CLEANUP_SCHEMA } from '../sqlite/plugin-state.schema';

const ALLOCATION_UNIT_BYTES = 512;
const SAFE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type PluginCleanupStatus = 'cleaning' | 'failed';

export interface PluginStorageUsage {
  readonly bytes: number;
  readonly directories: Readonly<Record<'source' | 'derived' | 'runtime', number>>;
  readonly tables: Readonly<Record<string, number>>;
}

export interface PluginDataCleanupOptions {
  readonly db: Database.Database;
  readonly pluginId: PluginId;
  readonly dataRoot: string;
  readonly dataStorage: PluginManifestDataStorage;
  readonly stopRuntime?: () => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export type PluginDataCleanupResult =
  | {
      readonly status: 'completed';
      readonly pluginId: PluginId;
      readonly releasedBytes: number;
      readonly usageBefore: PluginStorageUsage;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly error: string;
      readonly completedPaths: readonly string[];
    };

interface CleanupJobRow {
  readonly plugin_id: string;
  readonly status: PluginCleanupStatus;
  readonly completed_paths: string;
  readonly data_storage: string;
  readonly error: string | null;
}

function ensureCleanupTable(db: Database.Database): void {
  db.exec(PLUGIN_CLEANUP_SCHEMA);
  const columns = db.prepare('PRAGMA table_info(plugin_cleanup_jobs)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'data_storage')) {
    db.exec("ALTER TABLE plugin_cleanup_jobs ADD COLUMN data_storage TEXT NOT NULL DEFAULT '{}' ");
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('插件数据清理已取消，可重试继续清理');
}

function resolveDeclaredDirectory(dataRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`插件数据目录声明非法: ${relativePath}`);
  }
  const root = path.resolve(dataRoot);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件数据目录不能越出数据根: ${relativePath}`);
  }
  return resolved;
}

function declaredPaths(dataStorage: PluginManifestDataStorage): readonly { key: string; relativePath: string; category: 'source' | 'derived' | 'runtime' }[] {
  return (['source', 'derived', 'runtime'] as const).flatMap(category =>
    dataStorage.directories[category].map(relativePath => ({
      key: `${category}:${relativePath}`,
      relativePath,
      category,
    })),
  );
}

function allocationBytes(stat: fs.Stats): number {
  return typeof stat.blocks === 'number' && Number.isFinite(stat.blocks)
    ? stat.blocks * ALLOCATION_UNIT_BYTES
    : 0;
}

function directoryAllocationBytes(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory()) return allocationBytes(stat);
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    return total + directoryAllocationBytes(path.join(directory, entry.name));
  }, allocationBytes(stat));
}

function validateTableName(tableName: string): string {
  if (!SAFE_TABLE_NAME.test(tableName)) throw new Error(`插件数据表名非法: ${tableName}`);
  return tableName;
}

function tableRowCount(db: Database.Database, tableName: string): number {
  const safeName = validateTableName(tableName);
  const exists = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(safeName);
  if (!exists) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${safeName}"`).get() as { count: number };
  return row.count;
}

export function calculatePluginStorageUsage(options: Pick<PluginDataCleanupOptions, 'db' | 'dataRoot' | 'dataStorage'>): PluginStorageUsage {
  const directories = {
    source: 0,
    derived: 0,
    runtime: 0,
  };
  for (const declaration of declaredPaths(options.dataStorage)) {
    directories[declaration.category] += directoryAllocationBytes(
      resolveDeclaredDirectory(options.dataRoot, declaration.relativePath),
    );
  }
  const tables = Object.fromEntries(
    options.dataStorage.userDataTables.map(tableName => [tableName, tableRowCount(options.db, tableName)]),
  );
  return {
    bytes: Object.values(directories).reduce((total, value) => total + value, 0),
    directories,
    tables,
  };
}

function readCompletedPaths(db: Database.Database, pluginId: PluginId): Set<string> {
  const row = db.prepare('SELECT completed_paths FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(pluginId) as CleanupJobRow | undefined;
  if (!row) return new Set();
  const parsed: unknown = JSON.parse(row.completed_paths);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error(`插件清理进度损坏: ${pluginId}`);
  }
  return new Set(parsed);
}

function writeProgress(db: Database.Database, pluginId: PluginId, completedPaths: ReadonlySet<string>, now: number): void {
  db.prepare(`
    UPDATE plugin_cleanup_jobs
    SET status = 'cleaning', completed_paths = ?, error = NULL, updated_at = ?
    WHERE plugin_id = ?
  `).run(JSON.stringify([...completedPaths]), now, pluginId);
}

function markFailed(db: Database.Database, pluginId: PluginId, completedPaths: ReadonlySet<string>, error: unknown, now: number): string {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(`
    UPDATE plugin_cleanup_jobs
    SET status = 'failed', completed_paths = ?, error = ?, updated_at = ?
    WHERE plugin_id = ?
  `).run(JSON.stringify([...completedPaths]), message, now, pluginId);
  return message;
}

function dropOwnedTables(db: Database.Database, tableNames: readonly string[]): void {
  for (const tableName of [...tableNames].reverse()) {
    const safeName = validateTableName(tableName);
    db.prepare(`DROP TABLE IF EXISTS "${safeName}"`).run();
  }
}

/**
 * 删除插件声明的数据。目录清理可中断，SQLite 收尾保持一个事务，避免只删
 * 迁移账本而留下半套表。清理失败保留 job，下一次启动或用户重试可续清。
 */
export function cleanupPluginDataSync(options: PluginDataCleanupOptions): PluginDataCleanupResult {
  ensureCleanupTable(options.db);
  const now = options.now ?? Date.now;
  const usageBefore = calculatePluginStorageUsage(options);
  const existing = options.db.prepare('SELECT plugin_id FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId);
  const completedPaths = existing ? readCompletedPaths(options.db, options.pluginId) : new Set<string>();
  options.db.prepare(`
    INSERT INTO plugin_cleanup_jobs (plugin_id, status, completed_paths, data_storage, error, started_at, updated_at)
    VALUES (?, 'cleaning', ?, ?, NULL, ?, ?)
    ON CONFLICT(plugin_id) DO UPDATE SET status = 'cleaning', data_storage = excluded.data_storage, error = NULL, updated_at = excluded.updated_at
  `).run(options.pluginId, JSON.stringify([...completedPaths]), JSON.stringify(options.dataStorage), now(), now());

  try {
    assertNotAborted(options.signal);
    const stopResult = options.stopRuntime?.();
    if (stopResult instanceof Promise) {
      throw new Error('插件数据清理需要由异步生命周期入口先停止运行时');
    }
    for (const declaration of declaredPaths(options.dataStorage)) {
      assertNotAborted(options.signal);
      if (completedPaths.has(declaration.key)) continue;
      fs.rmSync(resolveDeclaredDirectory(options.dataRoot, declaration.relativePath), { recursive: true, force: true });
      completedPaths.add(declaration.key);
      writeProgress(options.db, options.pluginId, completedPaths, now());
    }
    assertNotAborted(options.signal);
    const finish = options.db.transaction(() => {
      dropOwnedTables(options.db, options.dataStorage.userDataTables);
      options.db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(options.pluginId);
      options.db.prepare('UPDATE installed_plugins SET schema_version = 0 WHERE plugin_id = ?').run(options.pluginId);
      options.db.prepare('DELETE FROM plugin_cleanup_jobs WHERE plugin_id = ?').run(options.pluginId);
    });
    finish();
    return {
      status: 'completed',
      pluginId: options.pluginId,
      releasedBytes: usageBefore.bytes,
      usageBefore,
    };
  } catch (error) {
    const message = markFailed(options.db, options.pluginId, completedPaths, error, now());
    return { status: 'failed', pluginId: options.pluginId, error: message, completedPaths: [...completedPaths] };
  }
}

export async function cleanupPluginData(options: PluginDataCleanupOptions): Promise<PluginDataCleanupResult> {
  await options.stopRuntime?.();
  return cleanupPluginDataSync({ ...options, stopRuntime: undefined });
}

export async function resumePluginDataCleanup(options: PluginDataCleanupOptions): Promise<PluginDataCleanupResult> {
  ensureCleanupTable(options.db);
  const job = options.db.prepare('SELECT plugin_id, status, completed_paths, error FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId) as CleanupJobRow | undefined;
  if (!job) return cleanupPluginData(options);
  return cleanupPluginData(options);
}

export function resumePendingPluginDataCleanupsSync(options: {
  readonly db: Database.Database;
  readonly dataRoot: string;
  readonly resolveStorage: (pluginId: PluginId) => PluginManifestDataStorage | null;
}): readonly PluginDataCleanupResult[] {
  ensureCleanupTable(options.db);
  const jobs = options.db.prepare('SELECT plugin_id, data_storage FROM plugin_cleanup_jobs ORDER BY started_at').all() as Array<{ plugin_id: string; data_storage: string }>;
  const results: PluginDataCleanupResult[] = [];
  for (const job of jobs) {
    const declaredStorage = PluginManifestDataStorageSchema.parse(JSON.parse(job.data_storage));
    const dataStorage = options.resolveStorage(job.plugin_id) ?? declaredStorage;
    if (!dataStorage) continue;
    results.push(cleanupPluginDataSync({
      db: options.db,
      pluginId: job.plugin_id,
      dataRoot: options.dataRoot,
      dataStorage,
    }));
  }
  return results;
}

/** 启动时只恢复已持久化的清理任务；没有任务时不扫描用户目录。 */
export async function resumePendingPluginDataCleanups(options: {
  readonly db: Database.Database;
  readonly dataRoot: string;
  readonly resolveStorage: (pluginId: PluginId) => PluginManifestDataStorage | null;
}): Promise<readonly PluginDataCleanupResult[]> {
  return resumePendingPluginDataCleanupsSync(options);
}
