import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  PluginId,
  PluginMeta,
  PluginRemoteInstallResult,
} from '@app/schemas';

import type { PluginUpgradeDiagnostic, PluginUpgradePlan } from '../../infrastructure/sqlite/plugin-upgrade.runner';
import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import { clearPluginUserRemovedMarker, markPluginUserRemoved } from '../functions/pluginRemovalMarker';
import { activatePluginVersionWithMigrations } from './activatePluginVersionWithMigrations';
import { installPluginUpdateFromRemote } from './installPluginUpdate';

export interface PluginUpgradePlanResolveInput {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly pluginDir: string;
  readonly appVersion: string;
}

export type PluginUpgradePlanResolver = (input: PluginUpgradePlanResolveInput) => PluginUpgradePlan;

export interface InstallPluginFromRemoteAndActivateOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly latestManifestUrl: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly knownPlugins: readonly PluginMeta[];
  readonly resolveUpgradePlan: PluginUpgradePlanResolver;
  readonly fetch?: typeof fetch;
  readonly recordDiagnostic?: (diagnostic: PluginUpgradeDiagnostic) => void;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolvePluginVersionDir(userPluginRoot: string, pluginId: PluginId, version: string): string {
  const rootDir = path.resolve(userPluginRoot);
  const versionDir = path.resolve(rootDir, pluginId, version);
  const relative = path.relative(rootDir, versionDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`插件版本目录不能指向插件根目录外: ${pluginId}@${version}`);
  }
  return versionDir;
}

function removeActivePointer(userPluginRoot: string, pluginId: PluginId): void {
  const rootDir = path.resolve(userPluginRoot);
  const activePath = path.resolve(rootDir, pluginId, 'active.json');
  const relative = path.relative(rootDir, activePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`active 指针不能指向插件根目录外: ${pluginId}`);
  }
  fs.rmSync(activePath, { force: true });
}

function toSkippedCurrentResult(
  options: InstallPluginFromRemoteAndActivateOptions,
  version: string,
  detail?: string,
): PluginRemoteInstallResult {
  return {
    status: 'skipped',
    pluginId: options.pluginId,
    version,
    reason: 'current',
    ...(detail ? { detail } : {}),
  };
}

function toFailedResult(
  pluginId: PluginId,
  version: string | null,
  error: string,
): PluginRemoteInstallResult {
  return {
    status: 'failed',
    pluginId,
    version,
    error,
  };
}

export async function installPluginFromRemoteAndActivate(
  options: InstallPluginFromRemoteAndActivateOptions,
): Promise<PluginRemoteInstallResult> {
  const stateService = new PluginStateService(options.db);
  const knownPlugin = options.knownPlugins.find((plugin) => plugin.id === options.pluginId);
  let previousRecord = stateService.getInstalledRecord(options.pluginId);
  const wasEnabled = new Set(stateService.getEnabledIds()).has(options.pluginId);

  if (!previousRecord && knownPlugin) {
    // 中文说明：老用户库可能是在某个插件进入 known meta 之前创建的。
    // 远程安装仍必须只允许 known plugin，但 known 插件缺 DB catalog 行时应先补登记，
    // 否则会把可安装官方插件误报成“未知插件”。
    stateService.ensureKnownPluginRegistered(knownPlugin);
    previousRecord = stateService.getInstalledRecord(options.pluginId);
  }

  if (!previousRecord) {
    return toFailedResult(options.pluginId, null, `未知插件，不能远程安装: ${options.pluginId}`);
  }

  const installResult = await installPluginUpdateFromRemote({
    pluginId: options.pluginId,
    latestManifestUrl: options.latestManifestUrl,
    userPluginRoot: options.userPluginRoot,
    appVersion: options.appVersion,
    rendererUiVersion: options.rendererUiVersion,
    fetch: options.fetch,
  });

  if (installResult.status === 'failed') {
    return installResult;
  }
  if (installResult.status === 'skipped' && installResult.reason === 'incompatible') {
    return {
      status: 'skipped',
      pluginId: installResult.pluginId,
      version: installResult.version,
      reason: 'incompatible',
      ...(installResult.detail ? { detail: installResult.detail } : {}),
    };
  }
  if (installResult.status === 'skipped' && installResult.reason === 'current') {
    if (previousRecord.installed && !previousRecord.userRemoved) {
      return toSkippedCurrentResult(options, installResult.version, installResult.detail);
    }

    try {
      stateService.setInstalled(options.pluginId, true, options.knownPlugins);
      clearPluginUserRemovedMarker(options.userPluginRoot, options.pluginId);
      return {
        status: 'installed',
        pluginId: options.pluginId,
        version: installResult.version,
        previousVersion: previousRecord.version,
        restartRequired: true,
      };
    } catch (error) {
      return toFailedResult(options.pluginId, installResult.version, readErrorMessage(error));
    }
  }

  const versionToActivate = installResult.version;
  const pluginDir = resolvePluginVersionDir(options.userPluginRoot, options.pluginId, versionToActivate);

  try {
    stateService.setInstalled(options.pluginId, true, options.knownPlugins);
    const upgradePlan = options.resolveUpgradePlan({
      pluginId: options.pluginId,
      version: versionToActivate,
      pluginDir,
      appVersion: options.appVersion,
    });
    const activationResult = activatePluginVersionWithMigrations({
      db: options.db,
      userPluginRoot: options.userPluginRoot,
      pluginId: options.pluginId,
      version: versionToActivate,
      appVersion: options.appVersion,
      upgradePlan,
      recordDiagnostic: options.recordDiagnostic,
    });

    if (activationResult.status !== 'activated') {
      throw new Error(activationResult.error);
    }
    if (previousRecord.installed && !wasEnabled) {
      stateService.setEnabled(options.pluginId, false, options.knownPlugins);
    }

    clearPluginUserRemovedMarker(options.userPluginRoot, options.pluginId);
    return {
      status: 'installed',
      pluginId: options.pluginId,
      version: versionToActivate,
      previousVersion: activationResult.previousVersion,
      restartRequired: true,
    };
  } catch (error) {
    if (!previousRecord.installed) {
      stateService.setInstalled(options.pluginId, false, options.knownPlugins);
      removeActivePointer(options.userPluginRoot, options.pluginId);
    }
    if (previousRecord.userRemoved) {
      stateService.setUserRemoved(options.pluginId, true);
      markPluginUserRemoved(options.userPluginRoot, options.pluginId);
    }
    if (previousRecord.installed && !wasEnabled) {
      stateService.setEnabled(options.pluginId, false, options.knownPlugins);
    }

    return toFailedResult(options.pluginId, versionToActivate, readErrorMessage(error));
  }
}
