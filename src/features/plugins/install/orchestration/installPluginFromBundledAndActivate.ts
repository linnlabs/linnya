import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { PluginId, PluginMeta, PluginOperationErrorCode } from '@app/schemas';

import type {
  PluginUpgradeDiagnostic,
  PluginUpgradePlan,
} from '../../infrastructure/sqlite/plugin-upgrade.runner';
import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import { clearPluginUserRemovedMarker } from '../functions/pluginRemovalMarker';
import {
  activateMigratedPluginVersion,
  migratePluginVersionForActivation,
} from './activatePluginVersionWithMigrations';
import { toPluginOperationError } from '../definitions/pluginOperationError';

export interface BundledPluginStageCandidate {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly pluginDir: string;
  /** 本次操作创建的版本目录；失败时只能清理这一目录。 */
  readonly createdVersionDir: boolean;
}

export interface InstallPluginFromBundledAndActivateOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly appVersion: string;
  readonly knownPlugins: readonly PluginMeta[];
  readonly stageBundledPlugin: () => BundledPluginStageCandidate;
  readonly resolveUpgradePlan: (input: {
    readonly pluginId: PluginId;
    readonly version: string;
    readonly pluginDir: string;
    readonly appVersion: string;
  }) => PluginUpgradePlan;
  readonly recordDiagnostic?: (diagnostic: PluginUpgradeDiagnostic) => void;
}

export type BundledPluginInstallResult =
  | {
      readonly status: 'installed';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly previousVersion: string | null;
      readonly restartRequired: boolean;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string | null;
      readonly error: string;
      readonly errorCode?: PluginOperationErrorCode;
    };

function failed(
  pluginId: PluginId,
  version: string | null,
  error: unknown,
): BundledPluginInstallResult {
  const operationError = toPluginOperationError(error, { pluginId });
  return {
    status: 'failed',
    pluginId,
    version,
    error: operationError.message,
    errorCode: operationError.code,
  };
}

function removeVersionDirectory(candidate: BundledPluginStageCandidate): void {
  if (!candidate.createdVersionDir) return;
  fs.rmSync(candidate.pluginDir, { recursive: true, force: true });
}

/**
 * Explicit local install/reinstall for a bundled plugin. This deliberately does not
 * share startup seeding: a user click is required to clear user_removed and reactivate
 * a plugin, while the plugin's owned data remains untouched.
 */
export function installPluginFromBundledAndActivate(
  options: InstallPluginFromBundledAndActivateOptions,
): BundledPluginInstallResult {
  const stateService = new PluginStateService(options.db);
  let previousRecord = stateService.getInstalledRecord(options.pluginId);
  if (!previousRecord) {
    const knownPlugin = options.knownPlugins.find(plugin => plugin.id === options.pluginId);
    if (knownPlugin) {
      stateService.ensureKnownPluginRegistered(knownPlugin);
      previousRecord = stateService.getInstalledRecord(options.pluginId);
    }
  }
  if (!previousRecord) {
    return failed(options.pluginId, null, `未知插件，不能从随包安装: ${options.pluginId}`);
  }
  if (previousRecord.installed) {
    return failed(options.pluginId, previousRecord.version, `插件已经安装: ${options.pluginId}`);
  }

  let candidate: BundledPluginStageCandidate;
  try {
    candidate = options.stageBundledPlugin();
  } catch (error) {
    return failed(options.pluginId, null, error);
  }

  const activation = {
    db: options.db, userPluginRoot: options.userPluginRoot, pluginId: candidate.pluginId, version: candidate.version,
  };
  const commitInstallation = options.db.transaction(() => {
    // 先前的三张表彼此独立提交；现在 SIGKILL 也只能看见完整旧态或可恢复的新态。
    stateService.setInstalled(options.pluginId, true, options.knownPlugins);
    const upgradePlan = options.resolveUpgradePlan({
      pluginId: candidate.pluginId, version: candidate.version, pluginDir: candidate.pluginDir, appVersion: options.appVersion,
    });
    const result = migratePluginVersionForActivation({
      ...activation, appVersion: options.appVersion, upgradePlan, recordDiagnostic: options.recordDiagnostic,
    });
    if (result.status === 'failed') {
      throw toPluginOperationError(new Error(result.error), {
        pluginId: options.pluginId, fallbackCode: result.errorCode,
      });
    }
    return result;
  });
  let migrated: ReturnType<typeof commitInstallation>;
  try {
    migrated = commitInstallation();
  } catch (error) {
    // SQLite 已回滚；此时从未触碰卸载文件标记或 active 指针。
    const installationError = toPluginOperationError(error, { pluginId: options.pluginId });
    try {
      removeVersionDirectory(candidate);
    } catch (cleanupError) {
      return failed(
        options.pluginId,
        candidate.version,
        `${installationError.message}；安装失败后的临时目录清理也失败: ${toPluginOperationError(cleanupError, { pluginId: options.pluginId }).message}`,
      );
    }
    return failed(options.pluginId, candidate.version, installationError);
  }

  let restartRequired = false;
  try {
    const result = activateMigratedPluginVersion(activation, migrated);
    if (result.status === 'failed') throw new Error(result.error);
    clearPluginUserRemovedMarker(options.userPluginRoot, options.pluginId);
  } catch (error) {
    // 提交后不能删除唯一能完成激活的产物，也不能把已迁移的数据改回「未安装」。
    restartRequired = true;
    options.recordDiagnostic?.({
      level: 'error', pluginId: options.pluginId, capability: 'migration',
      message: `随包安装已提交，启动时续做激活: ${toPluginOperationError(error).message}`,
    });
  }
  return {
    status: 'installed', pluginId: options.pluginId, version: candidate.version,
    previousVersion: migrated.previousVersion, restartRequired,
  };
}
