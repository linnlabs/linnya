import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import type { PluginId } from '@app/schemas';
import { parsePluginManifest } from '@app/schemas';
import type { PluginBackendContribution } from '../../../app-hosts/linnya/plugin-registry/types';
import { pluginDiagnostics } from '../../../app-hosts/linnya/plugin-registry/diagnostics';
import { compareDottedVersions } from '../../../features/plugins/functions/comparePluginVersions';
import { rollbackActivePluginVersion } from '../../../features/plugins/install/orchestration/activatePluginVersion';
import { withBackendPluginHostModuleResolver } from './backendHostModuleResolver';
import {
  discoverPluginDirsFromLayout,
  readJsonFile,
  resolveInsidePluginDir,
} from './pluginLayout';

export interface DiskBackendPluginLoadOptions {
  readonly pluginRoot?: string;
  readonly directPluginDirs?: readonly string[];
  readonly appVersion: string;
  readonly onActiveRollback?: (params: {
    readonly pluginId: PluginId;
    readonly failedVersion: string;
    readonly toVersion: string;
  }) => void;
}

export interface LoadedDiskBackendPlugin {
  readonly pluginDir: string;
  readonly contribution: PluginBackendContribution;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordLoaderDiagnostic(pluginId: PluginId | null, message: string): void {
  pluginDiagnostics.record({
    level: 'warn',
    pluginId,
    capability: null,
    message,
  });
}

function assertCompatible(pluginId: PluginId, appVersion: string, minApp: string | undefined): void {
  if (!minApp) return;
  const comparison = compareDottedVersions(appVersion, minApp);
  if (comparison === null) {
    throw new Error(`无法校验插件兼容版本: app=${appVersion}, minApp=${minApp}`);
  }
  if (comparison < 0) {
    throw new Error(`当前应用版本 ${appVersion} 低于插件最低要求 ${minApp}`);
  }
}

function readContributionCandidate(moduleExports: unknown): unknown {
  if (!isRecord(moduleExports)) {
    return null;
  }

  return moduleExports.backendPlugin ?? moduleExports.default ?? null;
}

function isPluginBackendContribution(value: unknown): value is PluginBackendContribution {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return false;
  }

  return typeof value.meta.id === 'string' &&
    typeof value.meta.name === 'string' &&
    typeof value.meta.version === 'string' &&
    typeof value.meta.description === 'string' &&
    typeof value.meta.developer === 'string';
}

function requireBackendContribution(pluginDir: string, entryPath: string): PluginBackendContribution {
  const requireFromPlugin = createRequire(entryPath);
  const moduleExports: unknown = withBackendPluginHostModuleResolver(pluginDir, () => requireFromPlugin(entryPath));
  const candidate = readContributionCandidate(moduleExports);
  if (!isPluginBackendContribution(candidate)) {
    throw new Error('插件 backend entry 未导出 backendPlugin contribution');
  }
  return candidate;
}

function loadBackendPluginFromDir(pluginDir: string, appVersion: string): LoadedDiskBackendPlugin | null {
  const manifestPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  let pluginId: PluginId | null = null;
  try {
    const manifest = parsePluginManifest(readJsonFile(manifestPath));
    pluginId = manifest.id;
    assertCompatible(manifest.id, appVersion, manifest.compat?.minApp);
    if (!manifest.entry.backend) {
      throw new Error('plugin.json 未声明 entry.backend');
    }

    const backendEntry = resolveInsidePluginDir(pluginDir, manifest.entry.backend, 'entry.backend');
    const contribution = requireBackendContribution(pluginDir, backendEntry);
    if (contribution.meta.id !== manifest.id || contribution.meta.version !== manifest.version) {
      throw new Error(
        `backend contribution 与 manifest 不一致: manifest=${manifest.id}@${manifest.version}, contribution=${contribution.meta.id}@${contribution.meta.version}`,
      );
    }

    console.log(`[plugin-loader] Loaded backend plugin ${manifest.id}@${manifest.version} from ${backendEntry}`);
    return {
      pluginDir,
      contribution,
    };
  } catch (error) {
    recordLoaderDiagnostic(pluginId, `加载磁盘插件失败: ${readErrorMessage(error)}`);
    return null;
  }
}

function resolveActiveLayoutPluginDir(pluginRoot: string | undefined, pluginDir: string): {
  readonly pluginId: PluginId;
  readonly version: string;
} | null {
  if (!pluginRoot) return null;
  const relative = path.relative(pluginRoot, pluginDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return {
    pluginId: parts[0],
    version: parts[1],
  };
}

function rollbackActivePluginAfterLoadFailure(
  pluginRoot: string | undefined,
  pluginDir: string,
  options?: {
    readonly onRolledBack?: (params: {
      readonly pluginId: PluginId;
      readonly failedVersion: string;
      readonly toVersion: string;
    }) => void;
  },
): string | null {
  const activeDir = resolveActiveLayoutPluginDir(pluginRoot, pluginDir);
  if (!activeDir || !pluginRoot) {
    return null;
  }

  const rollback = rollbackActivePluginVersion({
    userPluginRoot: pluginRoot,
    pluginId: activeDir.pluginId,
    failedVersion: activeDir.version,
  });
  if (rollback.status !== 'rolled-back') {
    return null;
  }

  recordLoaderDiagnostic(
    activeDir.pluginId,
    `插件 ${activeDir.pluginId}@${activeDir.version} 加载失败，已回滚 active.json 到 ${rollback.toVersion}`,
  );
  options?.onRolledBack?.({
    pluginId: activeDir.pluginId,
    failedVersion: activeDir.version,
    toVersion: rollback.toVersion,
  });
  return path.join(pluginRoot, activeDir.pluginId, rollback.toVersion);
}

export function loadBackendPluginsFromDisk(options: DiskBackendPluginLoadOptions): LoadedDiskBackendPlugin[] {
  const pluginDirs = discoverPluginDirsFromLayout({
    pluginRoot: options.pluginRoot,
    directPluginDirs: options.directPluginDirs,
    reportDiagnostic: (diagnostic) => recordLoaderDiagnostic(diagnostic.pluginId, diagnostic.message),
  });

  const loaded: LoadedDiskBackendPlugin[] = [];
  const seen = new Set<PluginId>();
  for (const pluginDir of pluginDirs) {
    let result = loadBackendPluginFromDir(pluginDir, options.appVersion);
    if (!result) {
      const rollbackDir = rollbackActivePluginAfterLoadFailure(options.pluginRoot, pluginDir, {
        onRolledBack: options.onActiveRollback,
      });
      if (rollbackDir) {
        result = loadBackendPluginFromDir(rollbackDir, options.appVersion);
      }
    }
    if (!result) continue;
    const pluginId = result.contribution.meta.id;
    if (seen.has(pluginId)) {
      recordLoaderDiagnostic(pluginId, '磁盘插件重复，已忽略后续实例');
      continue;
    }
    seen.add(pluginId);
    loaded.push(result);
  }

  return loaded;
}
