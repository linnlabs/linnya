import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  parsePluginManifest,
  pluginMetaFromManifest,
  type PluginId,
  type PluginMeta,
  type PluginOperationErrorCode,
  type PluginRemoteInstallResult,
} from '@app/schemas';

import type { PluginUpgradeDiagnostic, PluginUpgradePlan } from '../../infrastructure/sqlite/plugin-upgrade.runner';
import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import { clearPluginUserRemovedMarker, markPluginUserRemoved } from '../functions/pluginRemovalMarker';
import { activatePluginVersionWithMigrations } from './activatePluginVersionWithMigrations';
import { installPluginUpdateFromRemote } from './installPluginUpdate';
import { toPluginOperationError } from '../definitions/pluginOperationError';
import type { InstallPluginUpdateOptions, RemotePluginReleaseSource, RemotePluginRuntimeInstaller } from '../definitions/pluginInstall';

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
  /** 与 releaseSource 二选一；未签名 latest.json 只用于开发与 R2 smoke。 */
  readonly latestManifestUrl?: string;
  readonly releaseSource?: RemotePluginReleaseSource;
  readonly installRuntimes?: RemotePluginRuntimeInstaller;
  /**
   * 仅与官方已验签 catalog 来源一起开启：catalog 列出的插件即使本机从未登记（不随包、首次安装）也可安装，
   * 登记信息取自下载并通过校验的版本目录内 plugin.json，而不是 catalog 展示字段。
   */
  readonly allowCatalogListedPlugins?: boolean;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly knownPlugins: readonly PluginMeta[];
  readonly resolveUpgradePlan: PluginUpgradePlanResolver;
  readonly fetch?: typeof fetch;
  readonly signal?: InstallPluginUpdateOptions['signal'];
  readonly onProgress?: InstallPluginUpdateOptions['onProgress'];
  readonly recordDiagnostic?: (diagnostic: PluginUpgradeDiagnostic) => void;
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

/** 从已落盘、已校验的版本目录读取登记信息；远程安装的插件不是随包内置插件。 */
function readInstalledVersionMeta(userPluginRoot: string, pluginId: PluginId, version: string): PluginMeta {
  const versionDir = resolvePluginVersionDir(userPluginRoot, pluginId, version);
  const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(path.join(versionDir, 'plugin.json'), 'utf8')) as unknown);
  if (manifest.id !== pluginId || manifest.version !== version) {
    throw new Error(`版本目录内 plugin.json 与安装目标不一致: ${manifest.id}@${manifest.version}`);
  }
  return pluginMetaFromManifest(manifest, { builtin: false });
}

function toFailedResult(
  pluginId: PluginId,
  version: string | null,
  error: string,
  errorCode: PluginOperationErrorCode = 'unknown',
): PluginRemoteInstallResult {
  return {
    status: 'failed',
    pluginId,
    version,
    error,
    errorCode,
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

  if (!previousRecord && !options.allowCatalogListedPlugins) {
    return toFailedResult(options.pluginId, null, `未知插件，不能远程安装: ${options.pluginId}`);
  }

  const installResult = await installPluginUpdateFromRemote({
    pluginId: options.pluginId,
    latestManifestUrl: options.latestManifestUrl,
    releaseSource: options.releaseSource,
    installRuntimes: options.installRuntimes,
    userPluginRoot: options.userPluginRoot,
    appVersion: options.appVersion,
    rendererUiVersion: options.rendererUiVersion,
    fetch: options.fetch,
    signal: options.signal,
    onProgress: options.onProgress,
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
  let knownPlugins = options.knownPlugins;
  if (!previousRecord) {
    // catalog 已列出且版本目录已通过完整校验，按其 plugin.json 补登记（未安装状态），后续与已登记插件同一路径。
    try {
      const meta = readInstalledVersionMeta(options.userPluginRoot, options.pluginId, installResult.version);
      stateService.ensureKnownPluginRegistered(meta);
      knownPlugins = [...options.knownPlugins, meta];
    } catch (error) {
      const operationError = toPluginOperationError(error, { pluginId: options.pluginId });
      return toFailedResult(options.pluginId, installResult.version, operationError.message, operationError.code);
    }
    previousRecord = stateService.getInstalledRecord(options.pluginId);
    if (!previousRecord) {
      return toFailedResult(options.pluginId, installResult.version, `插件登记失败: ${options.pluginId}`);
    }
  }

  if (installResult.status === 'skipped' && installResult.reason === 'current') {
    if (previousRecord.installed && !previousRecord.userRemoved) {
      return toSkippedCurrentResult(options, installResult.version, installResult.detail);
    }

    try {
      stateService.setInstalled(options.pluginId, true, knownPlugins);
      clearPluginUserRemovedMarker(options.userPluginRoot, options.pluginId);
      return {
        status: 'installed',
        pluginId: options.pluginId,
        version: installResult.version,
        previousVersion: previousRecord.version,
        restartRequired: true,
      };
    } catch (error) {
      const operationError = toPluginOperationError(error, { pluginId: options.pluginId });
      return toFailedResult(
        options.pluginId,
        installResult.version,
        operationError.message,
        operationError.code,
      );
    }
  }

  const versionToActivate = installResult.version;
  const pluginDir = resolvePluginVersionDir(options.userPluginRoot, options.pluginId, versionToActivate);

  try {
    stateService.setInstalled(options.pluginId, true, knownPlugins);
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
      throw toPluginOperationError(new Error(activationResult.error), {
        pluginId: options.pluginId,
        fallbackCode: activationResult.errorCode,
      });
    }
    if (previousRecord.installed && !wasEnabled) {
      stateService.setEnabled(options.pluginId, false, knownPlugins);
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
      stateService.setInstalled(options.pluginId, false, knownPlugins);
      removeActivePointer(options.userPluginRoot, options.pluginId);
    }
    if (previousRecord.userRemoved) {
      stateService.setUserRemoved(options.pluginId, true);
      markPluginUserRemoved(options.userPluginRoot, options.pluginId);
    }
    if (previousRecord.installed && !wasEnabled) {
      stateService.setEnabled(options.pluginId, false, knownPlugins);
    }

    const operationError = toPluginOperationError(error, { pluginId: options.pluginId });
    return toFailedResult(
      options.pluginId,
      versionToActivate,
      operationError.message,
      operationError.code,
    );
  }
}
