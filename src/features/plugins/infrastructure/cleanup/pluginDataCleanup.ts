import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { PluginManifestDataStorageSchema, type PluginCleanupFailureReason, type PluginDataSummary, type PluginId, type PluginManifestDataStorage } from '@app/schemas';

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
  /** Manifest 顶层 ownedTables：用于清理；dataStorage.userDataTables 只用于判断真实资料。 */
  readonly ownedTables?: readonly string[];
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
      readonly errorCode: PluginCleanupFailureReason;
      readonly completedPaths: readonly string[];
    };

interface CleanupJobRow {
  readonly plugin_id: string;
  readonly status: PluginCleanupStatus;
  readonly completed_paths: string;
  readonly data_storage: string;
  readonly error: string | null;
  readonly error_code: PluginCleanupFailureReason | null;
}

export interface PersistedCleanupStorage {
  readonly dataStorage: PluginManifestDataStorage;
  readonly ownedTables: readonly string[];
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

function directoryAllocationBytes(directory: string, excludedDirectories: readonly string[] = []): number {
  if (!fs.existsSync(directory)) return 0;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (isMissingPathError(error)) return 0;
    throw error;
  }
  if (!stat.isDirectory()) return allocationBytes(stat);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return 0;
    throw error;
  }
  return entries.reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (excludedDirectories.some(excluded => path.resolve(excluded) === path.resolve(entryPath))) return total;
    return total + directoryAllocationBytes(entryPath, excludedDirectories);
  }, allocationBytes(stat));
}

async function directoryAllocationBytesAsync(directory: string, excludedDirectories: readonly string[] = []): Promise<number> {
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
    total += await directoryAllocationBytesAsync(entryPath, excludedDirectories);
  }
  return total;
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT');
}

export function classifyPluginCleanupError(error: unknown): PluginCleanupFailureReason {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.includes('已取消') || message.includes('停止')) return 'interrupted';
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  if (code === 'EBUSY' || code === 'EPERM') return 'file-locked';
  if (code === 'EACCES' || code === 'EROFS') return 'permission-denied';
  if (code === 'ENOSPC') return 'disk-full';
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

export function calculatePluginStorageUsage(options: Pick<PluginDataCleanupOptions, 'db' | 'dataRoot' | 'dataStorage'>): PluginStorageUsage {
  const directories = {
    source: 0,
    derived: 0,
    runtime: 0,
  };
  const declarations = declaredPaths(options.dataStorage);
  for (const declaration of declarations) {
    const resolved = resolveDeclaredDirectory(options.dataRoot, declaration.relativePath);
    const excluded = declarations
      .map(candidate => resolveDeclaredDirectory(options.dataRoot, candidate.relativePath))
      .filter(candidate => candidate !== resolved && isPathWithin(candidate, resolved));
    directories[declaration.category] += directoryAllocationBytes(
      resolved,
      excluded,
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

export async function calculatePluginStorageUsageAsync(
  options: Pick<PluginDataCleanupOptions, 'db' | 'dataRoot' | 'dataStorage'>,
): Promise<PluginStorageUsage> {
  const directories = { source: 0, derived: 0, runtime: 0 };
  const declarations = declaredPaths(options.dataStorage);
  for (const declaration of declarations) {
    const resolved = resolveDeclaredDirectory(options.dataRoot, declaration.relativePath);
    const excluded = declarations
      .map(candidate => resolveDeclaredDirectory(options.dataRoot, candidate.relativePath))
      .filter(candidate => candidate !== resolved && isPathWithin(candidate, resolved));
    directories[declaration.category] += await directoryAllocationBytesAsync(
      resolved,
      excluded,
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

export function readPluginDataSummary(options: {
  readonly db: Database.Database;
  readonly pluginId: PluginId;
  readonly dataRoot: string;
  readonly dataStorage: PluginManifestDataStorage;
  readonly pluginInstalled: boolean;
  readonly workspaceRoot: string;
}): PluginDataSummary {
  const usage = calculatePluginStorageUsage(options);
  const cleanupTableExists = options.db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'plugin_cleanup_jobs'",
  ).get();
  const job: { status: PluginCleanupStatus; error: string | null; error_code: PluginCleanupFailureReason | null } | undefined = cleanupTableExists
    ? options.db.prepare('SELECT status, error, error_code FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId) as { status: PluginCleanupStatus; error: string | null; error_code: PluginCleanupFailureReason | null } | undefined
    : undefined;
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
      ...(job.error ? { error: job.error, errorCode: job.error_code ?? classifyPluginCleanupError(job.error) } : {}),
      canDelete: true,
    };
  }
  const status = options.pluginInstalled ? (hasData ? 'installed' : 'empty') : (hasData ? (isLegacy ? 'legacy' : 'retained') : 'empty');
  return {
    status,
    bytes: usage.bytes,
    directories: usage.directories,
    tables: usage.tables,
    canDelete: hasData,
  };
}

export async function readPluginDataSummaryAsync(options: {
  readonly db: Database.Database;
  readonly pluginId: PluginId;
  readonly dataRoot: string;
  readonly dataStorage: PluginManifestDataStorage;
  readonly pluginInstalled: boolean;
  readonly workspaceRoot: string;
}): Promise<PluginDataSummary> {
  const usage = await calculatePluginStorageUsageAsync(options);
  const cleanupTableExists = options.db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'plugin_cleanup_jobs'",
  ).get();
  const job: { status: PluginCleanupStatus; error: string | null; error_code: PluginCleanupFailureReason | null } | undefined = cleanupTableExists
    ? options.db.prepare('SELECT status, error, error_code FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId) as { status: PluginCleanupStatus; error: string | null; error_code: PluginCleanupFailureReason | null } | undefined
    : undefined;
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
      ...(job.error ? { error: job.error, errorCode: job.error_code ?? classifyPluginCleanupError(job.error) } : {}),
      canDelete: true,
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

function parsePersistedCleanupStorage(value: string): PersistedCleanupStorage {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('插件清理声明损坏');
  }
  const dataStorage = PluginManifestDataStorageSchema.parse(parsed);
  const ownedTablesValue = Reflect.get(parsed, 'ownedTables');
  // 兼容首版清理任务：旧 job 没有 ownedTables，不能凭 userDataTables 猜测要删哪些表。
  // 这类任务会保留为 failed，等待使用当前 manifest 重试，而不是误删表。
  if (ownedTablesValue === undefined) return { dataStorage, ownedTables: [] };
  if (!Array.isArray(ownedTablesValue) || !ownedTablesValue.every(item => typeof item === 'string')) {
    throw new Error('插件清理表声明损坏');
  }
  return { dataStorage, ownedTables: ownedTablesValue };
}

function hasPersistedOwnedTables(value: string): boolean {
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === 'object' && parsed !== null && Array.isArray(Reflect.get(parsed, 'ownedTables'));
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
    INSERT INTO plugin_cleanup_jobs (plugin_id, status, completed_paths, data_storage, error, error_code, started_at, updated_at)
    VALUES (?, 'cleaning', ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(plugin_id) DO UPDATE SET status = 'cleaning', data_storage = excluded.data_storage, error = NULL, error_code = NULL, updated_at = excluded.updated_at
  `).run(
    options.pluginId,
    JSON.stringify([...completedPaths]),
    JSON.stringify({ ...options.dataStorage, ownedTables: options.ownedTables ?? [] }),
    now(),
    now(),
  );

  try {
    assertNotAborted(options.signal);
    const stopResult = options.stopRuntime?.();
    if (stopResult instanceof Promise) {
      throw new Error('插件数据清理需要由异步生命周期入口先停止运行时');
    }
    for (const declaration of [...declaredPaths(options.dataStorage)].sort(cleanupPathOrder)) {
      assertNotAborted(options.signal);
      if (completedPaths.has(declaration.key)) continue;
      fs.rmSync(resolveDeclaredDirectory(options.dataRoot, declaration.relativePath), { recursive: true, force: true });
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
    return {
      status: 'completed',
      pluginId: options.pluginId,
      releasedBytes: usageBefore.bytes,
      usageBefore,
    };
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

export async function cleanupPluginData(options: PluginDataCleanupOptions): Promise<PluginDataCleanupResult> {
  await options.stopRuntime?.();
  ensureCleanupTable(options.db);
  const now = options.now ?? Date.now;
  const usageBefore = await calculatePluginStorageUsageAsync(options);
  const existing = options.db.prepare('SELECT plugin_id FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId);
  const completedPaths = existing ? readCompletedPaths(options.db, options.pluginId) : new Set<string>();
  options.db.prepare(`
    INSERT INTO plugin_cleanup_jobs (plugin_id, status, completed_paths, data_storage, error, error_code, started_at, updated_at)
    VALUES (?, 'cleaning', ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(plugin_id) DO UPDATE SET status = 'cleaning', data_storage = excluded.data_storage, error = NULL, error_code = NULL, updated_at = excluded.updated_at
  `).run(
    options.pluginId,
    JSON.stringify([...completedPaths]),
    JSON.stringify({ ...options.dataStorage, ownedTables: options.ownedTables ?? [] }),
    now(),
    now(),
  );

  try {
    assertNotAborted(options.signal);
    for (const declaration of [...declaredPaths(options.dataStorage)].sort(cleanupPathOrder)) {
      assertNotAborted(options.signal);
      if (completedPaths.has(declaration.key)) continue;
      await new Promise<void>(resolve => setImmediate(resolve));
      fs.rmSync(resolveDeclaredDirectory(options.dataRoot, declaration.relativePath), { recursive: true, force: true });
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

export async function resumePluginDataCleanup(options: PluginDataCleanupOptions): Promise<PluginDataCleanupResult> {
  ensureCleanupTable(options.db);
  const job = options.db.prepare('SELECT plugin_id, status, completed_paths, data_storage, error FROM plugin_cleanup_jobs WHERE plugin_id = ?').get(options.pluginId) as CleanupJobRow | undefined;
  if (!job) return cleanupPluginData(options);
  const persisted = parsePersistedCleanupStorage(job.data_storage);
  return cleanupPluginData({
    ...options,
    dataStorage: persisted.dataStorage,
    // 首版 job 没保存 ownedTables；当前 manifest 传入的声明优先，避免误删。
    ownedTables: options.ownedTables ?? persisted.ownedTables,
  });
}

export function resumePendingPluginDataCleanupsSync(options: {
  readonly db: Database.Database;
  readonly resolveStorage: (pluginId: PluginId) => (PersistedCleanupStorage | null);
  readonly resolveDataRoot: (pluginId: PluginId, storage: PersistedCleanupStorage) => string;
}): readonly PluginDataCleanupResult[] {
  ensureCleanupTable(options.db);
  const jobs = options.db.prepare('SELECT plugin_id, data_storage FROM plugin_cleanup_jobs ORDER BY started_at').all() as Array<{ plugin_id: string; data_storage: string }>;
  const results: PluginDataCleanupResult[] = [];
  for (const job of jobs) {
    const declaredStorage = parsePersistedCleanupStorage(job.data_storage);
    const resolvedStorage = options.resolveStorage(job.plugin_id);
    const storage = resolvedStorage ?? declaredStorage;
    if (!resolvedStorage && !hasPersistedOwnedTables(job.data_storage)) continue;
    results.push(cleanupPluginDataSync({
      db: options.db,
      pluginId: job.plugin_id,
      dataRoot: options.resolveDataRoot(job.plugin_id, storage),
      dataStorage: storage.dataStorage,
      ownedTables: storage.ownedTables,
    }));
  }
  return results;
}

/** 启动时只恢复已持久化的清理任务；没有任务时不扫描用户目录。 */
export async function resumePendingPluginDataCleanups(options: {
  readonly db: Database.Database;
  readonly resolveStorage: (pluginId: PluginId) => (PersistedCleanupStorage | null);
  readonly resolveDataRoot: (pluginId: PluginId, storage: PersistedCleanupStorage) => string;
}): Promise<readonly PluginDataCleanupResult[]> {
  return resumePendingPluginDataCleanupsSync(options);
}
