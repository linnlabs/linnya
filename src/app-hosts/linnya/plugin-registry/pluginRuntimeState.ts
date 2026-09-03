import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';

export type PluginRuntimeState = 'enabled' | 'disabled' | 'missing';

interface PluginRuntimeStateOverride {
  readonly installedPluginIds: ReadonlySet<PluginId>;
  readonly enabledPluginIds: ReadonlySet<PluginId>;
}

interface InstalledPluginRuntimeRow {
  readonly installed: number;
}

let runtimeDatabase: Database.Database | null = null;
let testOverride: PluginRuntimeStateOverride | null = null;

export class PluginRuntimeDatabaseNotReadyError extends Error {
  constructor() {
    super('[plugin-runtime-state] 插件运行态数据库尚未注入');
    this.name = 'PluginRuntimeDatabaseNotReadyError';
  }
}

export class PluginRuntimeDatabaseQueryError extends Error {
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`[plugin-runtime-state] 查询插件运行态失败: ${operation}`);
    this.name = 'PluginRuntimeDatabaseQueryError';
    this.cause = cause;
  }
}

function toPluginIdSet(pluginIds: readonly PluginId[] | ReadonlySet<PluginId> | undefined): ReadonlySet<PluginId> {
  return new Set(pluginIds ?? []);
}

function requireRuntimeDatabase(): Database.Database {
  if (!runtimeDatabase) {
    throw new PluginRuntimeDatabaseNotReadyError();
  }
  return runtimeDatabase;
}

function getDatabaseRuntimeState(pluginId: PluginId): PluginRuntimeState {
  const db = requireRuntimeDatabase();

  try {
    const installedRow = db
      .prepare('SELECT installed FROM installed_plugins WHERE plugin_id = ?')
      .get(pluginId) as InstalledPluginRuntimeRow | undefined;
    if (!installedRow || installedRow.installed !== 1) {
      return 'missing';
    }

    const enabledRow = db
      .prepare('SELECT plugin_id FROM enabled_plugins WHERE plugin_id = ?')
      .get(pluginId) as { readonly plugin_id: string } | undefined;
    return enabledRow ? 'enabled' : 'disabled';
  } catch (error) {
    throw new PluginRuntimeDatabaseQueryError(`get state for ${pluginId}`, error);
  }
}

function listDatabaseEnabledPluginIds(): ReadonlySet<PluginId> {
  const db = requireRuntimeDatabase();

  try {
    const rows = db
      .prepare(`
        SELECT enabled_plugins.plugin_id
        FROM enabled_plugins
        INNER JOIN installed_plugins
          ON installed_plugins.plugin_id = enabled_plugins.plugin_id
        WHERE installed_plugins.installed = 1
      `)
      .all() as Array<{ readonly plugin_id: string }>;
    return new Set(rows.map((row) => row.plugin_id));
  } catch (error) {
    throw new PluginRuntimeDatabaseQueryError('list enabled plugin ids', error);
  }
}

export function setPluginRuntimeDatabase(db: Database.Database): void {
  if (runtimeDatabase && runtimeDatabase !== db) {
    throw new Error('[plugin-runtime-state] 插件运行态数据库已注入，不能被另一个 Database 实例覆盖');
  }
  runtimeDatabase = db;
}

export function isPluginRuntimeDatabaseReady(): boolean {
  return runtimeDatabase !== null || testOverride !== null;
}

export function clearPluginRuntimeDatabaseForTests(): void {
  runtimeDatabase = null;
}

export function setPluginRuntimeStateForTests(options: {
  readonly installedPluginIds?: readonly PluginId[] | ReadonlySet<PluginId>;
  readonly enabledPluginIds?: readonly PluginId[] | ReadonlySet<PluginId>;
}): void {
  const enabledPluginIds = toPluginIdSet(options.enabledPluginIds);
  const installedPluginIds = new Set([
    ...toPluginIdSet(options.installedPluginIds),
    ...enabledPluginIds,
  ]);
  testOverride = { installedPluginIds, enabledPluginIds };
}

export function clearPluginRuntimeStateForTests(): void {
  testOverride = null;
}

export function getPluginRuntimeState(pluginId: PluginId): PluginRuntimeState {
  if (testOverride) {
    if (!testOverride.installedPluginIds.has(pluginId)) {
      return 'missing';
    }
    return testOverride.enabledPluginIds.has(pluginId) ? 'enabled' : 'disabled';
  }

  return getDatabaseRuntimeState(pluginId);
}

export function isPluginRuntimeEnabled(pluginId: PluginId): boolean {
  return getPluginRuntimeState(pluginId) === 'enabled';
}

export function getRuntimeEnabledPluginIds(): ReadonlySet<PluginId> {
  if (testOverride) {
    return new Set(testOverride.enabledPluginIds);
  }
  return listDatabaseEnabledPluginIds();
}
