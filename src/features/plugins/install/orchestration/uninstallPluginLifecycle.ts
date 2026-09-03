import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { PluginId, PluginMeta } from '@app/schemas';

import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import {
  markPluginUserRemoved,
  pluginRemovalMarkerFileName,
} from '../functions/pluginRemovalMarker';

export interface UninstallPluginLifecycleOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly knownPlugins: readonly PluginMeta[];
}

export type UninstallPluginLifecycleResult =
  | {
      readonly status: 'uninstalled';
      readonly pluginId: PluginId;
      readonly removedActivePointer: boolean;
      readonly removedEntries: readonly string[];
      readonly userDataPreserved: true;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly error: string;
    };

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    const stateService = new PluginStateService(options.db);
    stateService.setInstalled(options.pluginId, false, options.knownPlugins);
    stateService.setUserRemoved(options.pluginId, true);

    const pluginInstallDir = resolvePluginInstallDir(options.userPluginRoot, options.pluginId);
    const removalResult = removePluginRuntimeEntries(pluginInstallDir);
    markPluginUserRemoved(options.userPluginRoot, options.pluginId);

    return {
      status: 'uninstalled',
      pluginId: options.pluginId,
      removedActivePointer: removalResult.removedActivePointer,
      removedEntries: removalResult.removedEntries,
      userDataPreserved: true,
    };
  } catch (error) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: readErrorMessage(error),
    };
  }
}
