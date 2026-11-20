import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { PluginCleanupFailureReason, PluginDataSummary, PluginId, PluginManifestDataStorage } from '@app/schemas';

import { PLUGIN_CLEANUP_SCHEMA } from '../sqlite/plugin-state.schema';
import { assertPluginDataDirectory, isMissingPathError } from './pluginDataPaths';

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
  /** Manifest 顶层 ownedTables：用于清理；dataStorage.userDataTables 只用于判断真实资料。 */
  readonly ownedTables?: readonly string[];
  readonly stopRuntime?: () => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onStarted?: () => void;
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
      readonly errorCode: PluginCleanupFailureReason;
      readonly completedPaths: readonly string[];
    };

interface CleanupProgressRow {
  readonly completed_paths: string;
  readonly data_storage: string;
}

function ensureCleanupTable(db: Database.Database): void {
  db.exec(PLUGIN_CLEANUP_SCHEMA);
  const columns = db.prepare('PRAGMA table_info(plugin_cleanup_jobs)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'data_storage')) {
    db.exec("ALTER TABLE plugin_cleanup_jobs ADD COLUMN data_storage TEXT NOT NULL DEFAULT '{}' ");
  }
  if (!columns.some(column => column.name === 'error_code')) {
    db.exec('ALTER TABLE plugin_cleanup_jobs ADD COLUMN error_code TEXT');
  }
}

class PluginCleanupInterruptedError extends Error {}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PluginCleanupInterruptedError('插件数据清理已取消，可重试继续清理');
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

function cleanupPathOrder(left: { readonly relativePath: string }, right: { readonly relativePath: string }): number {
  const leftPath = left.relativePath.replace(/\\/g, '/');
  const rightPath = right.relativePath.replace(/\\/g, '/');
  if (leftPath !== rightPath && leftPath.startsWith(`${rightPath}/`)) return -1;
  if (leftPath !== rightPath && rightPath.startsWith(`${leftPath}/`)) return 1;
  return 0;
}

function allocationBytes(stat: fs.Stats): number {
  return typeof stat.blocks === 'number' && Number.isFinite(stat.blocks)
    ? stat.blocks * ALLOCATION_UNIT_BYTES
    : 0;
}

function isPathWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function directoryAllocationBytesAsync(directory: string, excludedDirectories: readonly string[], signal?: AbortSignal): Promise<number> {
  assertNotAborted(signal);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(directory);
  } catch (error) {
    if (isMissingPathError(error)) return 0;
    throw error;
  }
  if (!stat.isDirectory()) return allocationBytes(stat);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return 0;
    throw error;
  }
  let total = allocationBytes(stat);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (excludedDirectories.some(excluded => path.resolve(excluded) === path.resolve(entryPath))) continue;
    total += await directoryAllocationBytesAsync(entryPath, excludedDirectories, signal);
  }
  return total;
}

export function classifyPluginCleanupError(error: unknown): PluginCleanupFailureReason {
  if (error instanceof PluginCleanupInterruptedError) return 'interrupted';
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  if (code === 'EBUSY') return 'file-locked';
  if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOSPC' || code === 'SQLITE_FULL') return 'disk-full';
  return 'unknown';
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

export async function calculatePluginStorageUsageAsync(
  options: Pick<PluginDataCleanupOptions, 'db' | 'dataRoot' | 'dataStorage' | 'signal'>,
): Promise<PluginStorageUsage> {
  const directories = { source: 0, derived: 0, runtime: 0 };
  const declarations = declaredPaths(options.dataStorage);
  for (const declaration of declarations) {
    const resolved = resolveDeclaredDirectory(options.dataRoot, declaration.relativePath);
    const excluded = declarations
      .map(candidate => resolveDeclaredDirectory(options.dataRoot, candidate.relativePath))
      .filter(candidate => candidate !== resolved && isPathWithin(candidate, resolved));
    if (!assertPluginDataDirectory(options.dataRoot, resolved)) continue;
    directories[declaration.category] += await directoryAllocationBytesAsync(
      resolved,
      excluded,
      options.signal,
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

export async function readPluginDataSummaryAsync(options: {
  readonly db: Database.Database;
  readonly pluginId: PluginId;
  readonly dataRoot: string;
  readonly dataStorage: PluginManifestDataStorage;
  readonly pluginInstalled: boolean;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
}): Promise<PluginDataSummary> {
  const usage = await calculatePluginStorageUsageAsync(options);
  const job = options.db.prepare<[PluginId], { status: PluginCleanupStatus; error_code: PluginCleanupFailureReason | null }>(
    'SELECT status, error_code FROM plugin_cleanup_jobs WHERE plugin_id = ?',
  ).get(options.pluginId);
  const hasTableRows = Object.values(usage.tables).some(count => count > 0);
  const hasData = usage.bytes > 0 || hasTableRows;
  const pluginRoot = path.resolve(options.workspaceRoot, 'Plugins');
  const resolvedRoot = path.resolve(options.dataRoot);
  const isLegacy = !resolvedRoot.startsWith(`${pluginRoot}${path.sep}`);
  if (job?.status === 'cleaning' || job?.status === 'failed') {
    return {
      status: job.status,
      bytes: usage.bytes,
      directories: usage.directories,
      tables: usage.tables,
      ...(job.status === 'failed' ? { errorCode: job.error_code ?? 'unknown' } : {}),
      canDelete: job.status === 'failed',
    };
  }
  return {
    status: options.pluginInstalled ? (hasData ? 'installed' : 'empty') : (hasData ? (isLegacy ? 'legacy' : 'retained') : 'empty'),
    bytes: usage.bytes,
    directories: usage.directories,
    tables: usage.tables,
    canDelete: hasData,
  };
}

function readCompletedPaths(db: Database.Database, pluginId: PluginId, scope: string): Set<string> {
  const row = db.prepare<[string], CleanupProgressRow>(
    'SELECT completed_paths, data_storage FROM plugin_cleanup_jobs WHERE plugin_id = ?',
  ).get(pluginId);
  if (row?.data_storage !== scope) return new Set();
  const parsed: unknown = JSON.parse(row.completed_paths);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error(`插件清理进度损坏: ${pluginId}`);
  }
  return new Set(parsed);
}

function writeProgress(db: Database.Database, pluginId: PluginId, completedPaths: ReadonlySet<string>, now: number): void {
  db.prepare(`
    UPDATE plugin_cleanup_jobs
    SET status = 'cleaning', completed_paths = ?, error = NULL, error_code = NULL, updated_at = ?
    WHERE plugin_id = ?
  `).run(JSON.stringify([...completedPaths]), now, pluginId);
}

function markFailed(db: Database.Database, pluginId: PluginId, completedPaths: ReadonlySet<string>, error: unknown, now: number): string {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = classifyPluginCleanupError(error);
  db.prepare(`
    UPDATE plugin_cleanup_jobs
    SET status = 'failed', completed_paths = ?, error = ?, error_code = ?, updated_at = ?
    WHERE plugin_id = ?
  `).run(JSON.stringify([...completedPaths]), message, errorCode, now, pluginId);
  return message;
}

function dropOwnedTables(db: Database.Database, tableNames: readonly string[]): void {
  for (const tableName of [...tableNames].reverse()) {
    const safeName = validateTableName(tableName);
    db.prepare(`DROP TABLE IF EXISTS "${safeName}"`).run();
  }
}

/** 逐项让出事件循环；中止后不再删下一项，已经删除的项在重试时自然跳过。 */
async function removePluginDataEntry(target: string, signal: AbortSignal | undefined): Promise<void> {
  assertNotAborted(signal);
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isDirectory()) {
      for (const name of await fs.promises.readdir(target)) {
        await removePluginDataEntry(path.join(target, name), signal);
      }
      assertNotAborted(signal);
      await fs.promises.rmdir(target);
    } else {
      assertNotAborted(signal);
      // 子项可能是软链接。只删除链接本身，不跟随链接目标。
      await fs.promises.unlink(target);
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

export async function cleanupPluginData(options: PluginDataCleanupOptions): Promise<PluginDataCleanupResult> {
  ensureCleanupTable(options.db);
  const now = options.now ?? Date.now;
  // 旧任务只提供进度，绝不能授予路径或删表权限。若范围已变，按当前范围重新检查。
  const scope = JSON.stringify({ dataRoot: options.dataRoot, dataStorage: options.dataStorage, ownedTables: options.ownedTables });
  const completedPaths = readCompletedPaths(options.db, options.pluginId, scope);
  options.db.prepare(`
    INSERT INTO plugin_cleanup_jobs (plugin_id, status, completed_paths, data_storage, error, error_code, started_at, updated_at)
    VALUES (?, 'cleaning', ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(plugin_id) DO UPDATE SET status = 'cleaning', completed_paths = excluded.completed_paths,
      data_storage = excluded.data_storage, error = NULL, error_code = NULL, updated_at = excluded.updated_at
  `).run(
    options.pluginId,
    JSON.stringify([...completedPaths]),
    scope,
    now(),
    now(),
  );

  try {
    options.onStarted?.();
    assertNotAborted(options.signal);
    await options.stopRuntime?.();
    const usageBefore = await calculatePluginStorageUsageAsync(options);
    for (const declaration of [...declaredPaths(options.dataStorage)].sort(cleanupPathOrder)) {
      assertNotAborted(options.signal);
      if (completedPaths.has(declaration.key)) continue;
      const target = resolveDeclaredDirectory(options.dataRoot, declaration.relativePath);
      if (assertPluginDataDirectory(options.dataRoot, target)) {
        await removePluginDataEntry(target, options.signal);
      }
      completedPaths.add(declaration.key);
      writeProgress(options.db, options.pluginId, completedPaths, now());
    }
    assertNotAborted(options.signal);
    const finish = options.db.transaction(() => {
      dropOwnedTables(options.db, options.ownedTables ?? []);
      options.db.prepare('DELETE FROM plugin_migrations WHERE plugin_id = ?').run(options.pluginId);
      options.db.prepare('UPDATE installed_plugins SET schema_version = 0 WHERE plugin_id = ?').run(options.pluginId);
      options.db.prepare('DELETE FROM plugin_cleanup_jobs WHERE plugin_id = ?').run(options.pluginId);
    });
    finish();
    return { status: 'completed', pluginId: options.pluginId, releasedBytes: usageBefore.bytes, usageBefore };
  } catch (error) {
    const message = markFailed(options.db, options.pluginId, completedPaths, error, now());
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: message,
      errorCode: classifyPluginCleanupError(error),
      completedPaths: [...completedPaths],
    };
  }
}

/** 启动只恢复 UI 可见状态。用户重试时重新读取当前可信声明，再续清。 */
export function markInterruptedPluginDataCleanups(db: Database.Database): void {
  ensureCleanupTable(db);
  db.prepare(`
    UPDATE plugin_cleanup_jobs SET status = 'failed', error = ?, error_code = 'interrupted', updated_at = ?
    WHERE status = 'cleaning'
  `).run('插件数据清理因进程退出中断', Date.now());
}

export function hasPendingPluginDataCleanup(db: Database.Database, pluginId: PluginId): boolean {
  return db.prepare('SELECT 1 FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(pluginId) !== undefined;
}
