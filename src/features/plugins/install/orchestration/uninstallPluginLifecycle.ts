import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { PluginId, PluginMeta, PluginOperationErrorCode } from '@app/schemas';
import type { PluginManifestDataStorage } from '@app/schemas';

import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import { PluginActiveVersionService } from '../../infrastructure/sqlite/plugin-active-version.service';
import {
  markPluginUserRemoved,
  pluginRemovalMarkerFileName,
} from '../functions/pluginRemovalMarker';
import { toPluginOperationError } from '../definitions/pluginOperationError';
import { cleanupPluginData } from '../../infrastructure/cleanup/pluginDataCleanup';

export interface UninstallPluginLifecycleOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly knownPlugins: readonly PluginMeta[];
  /** 默认 false：卸载只移除运行产物，插件资料仍可被重装复用。 */
  readonly deleteData?: boolean;
  readonly dataRoot?: string;
  readonly dataStorage?: PluginManifestDataStorage;
  readonly ownedTables?: readonly string[];
  readonly stopRuntime?: () => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onCleanupStarted?: () => void;
}

export type UninstallPluginLifecycleResult =
  | {
      readonly status: 'uninstalled';
      readonly pluginId: PluginId;
      readonly removedActivePointer: boolean;
      readonly removedEntries: readonly string[];
      readonly userDataPreserved: boolean;
      readonly dataDeleted: boolean;
      readonly cleanupIncomplete?: boolean;
      readonly releasedBytes?: number;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly error: string;
      readonly errorCode?: PluginOperationErrorCode;
    };

function resolvePluginInstallDir(userPluginRoot: string, pluginId: PluginId): string {
  const rootDir = path.resolve(userPluginRoot);
  const pluginDir = path.resolve(rootDir, pluginId);
  const relative = path.relative(rootDir, pluginDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件安装目录不能指向插件根目录外: ${pluginId}`);
  }
  return pluginDir;
}

function removePluginRuntimeEntries(pluginInstallDir: string): {
  readonly removedActivePointer: boolean;
  readonly removedEntries: readonly string[];
} {
  if (!fs.existsSync(pluginInstallDir)) {
    return { removedActivePointer: false, removedEntries: [] };
  }

  const removedEntries: string[] = [];
  let removedActivePointer = false;
  for (const entry of fs.readdirSync(pluginInstallDir, { withFileTypes: true })) {
    if (entry.name === pluginRemovalMarkerFileName) {
      continue;
    }

    const entryPath = path.join(pluginInstallDir, entry.name);
    fs.rmSync(entryPath, { recursive: entry.isDirectory(), force: true });
    if (entry.name === 'active.json') {
      removedActivePointer = true;
    } else {
      removedEntries.push(entry.name);
    }
  }

  return { removedActivePointer, removedEntries };
}

export function uninstallPluginLifecycle(
  options: UninstallPluginLifecycleOptions,
): UninstallPluginLifecycleResult {
  try {
    const dataDeleted = Boolean(options.deleteData);
    if (options.deleteData) {
      if (!options.dataRoot || !options.dataStorage) {
        throw new Error('插件未声明可清理的数据目录，不能删除插件数据');
      }
      throw new Error('删除插件数据需要调用异步清理生命周期入口');
    }
    const stateService = new PluginStateService(options.db);
    const pluginInstallDir = resolvePluginInstallDir(options.userPluginRoot, options.pluginId);
    stateService.setInstalled(options.pluginId, false, options.knownPlugins);
    stateService.setUserRemoved(options.pluginId, true);
    new PluginActiveVersionService(options.db).removeRecord(options.pluginId);
    // 先落下主动移除标记，再删产物，避免中断后被随包 seed 装回。
    markPluginUserRemoved(options.userPluginRoot, options.pluginId);
    const removalResult = removePluginRuntimeEntries(pluginInstallDir);

    return {
      status: 'uninstalled',
      pluginId: options.pluginId,
      removedActivePointer: removalResult.removedActivePointer,
      removedEntries: removalResult.removedEntries,
      userDataPreserved: !options.deleteData,
      dataDeleted,
    };
  } catch (error) {
    const operationError = toPluginOperationError(error, { pluginId: options.pluginId });
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: operationError.message,
      errorCode: operationError.code,
    };
  }
}

/** 带数据删除选项的异步入口；默认卸载保持上面的同步兼容合同。 */
export async function uninstallPluginAndDeleteData(
  options: UninstallPluginLifecycleOptions,
): Promise<UninstallPluginLifecycleResult> {
  const record = new PluginStateService(options.db).getInstalledRecord(options.pluginId);
  if (record?.required) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: `核心插件不能卸载: ${options.pluginId}`,
      errorCode: 'unknown',
    };
  }
  if (!options.dataRoot || !options.dataStorage) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: '插件未声明可清理的数据目录，不能删除插件数据',
      errorCode: 'unknown',
    };
  }
  const result = uninstallPluginLifecycle({ ...options, deleteData: false });
  if (result.status !== 'uninstalled') return result;
  const cleanup = await cleanupPluginData({
    db: options.db,
    pluginId: options.pluginId,
    dataRoot: options.dataRoot,
    dataStorage: options.dataStorage,
    ownedTables: options.ownedTables ?? [],
    stopRuntime: options.stopRuntime,
    signal: options.signal,
    onStarted: options.onCleanupStarted,
  });
  return cleanup.status === 'completed'
    ? { ...result, userDataPreserved: false, dataDeleted: true, releasedBytes: cleanup.releasedBytes }
    : { ...result, userDataPreserved: false, cleanupIncomplete: true };
}
