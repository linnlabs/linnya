import fs from 'node:fs';
import path from 'node:path';
import { errorToString as readErrorMessage } from '@linnya/foundation';
import type Database from 'better-sqlite3';
import type { PluginId, PluginMeta } from '@app/schemas';

import type {
  PluginUpgradeDiagnostic,
  PluginUpgradePlan,
} from '../../infrastructure/sqlite/plugin-upgrade.runner';
import { PluginStateService } from '../../infrastructure/sqlite/plugin-state.service';
import {
  clearPluginUserRemovedMarker,
  markPluginUserRemoved,
} from '../functions/pluginRemovalMarker';
import { activatePluginVersionWithMigrations } from './activatePluginVersionWithMigrations';

export interface BundledPluginStageCandidate {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly previousVersion: string | null;
  readonly pluginDir: string;
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
      readonly restartRequired: true;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string | null;
      readonly error: string;
    };

function removeActivePointer(userPluginRoot: string, pluginId: PluginId): void {
  const rootDir = path.resolve(userPluginRoot);
  const activePath = path.resolve(rootDir, pluginId, 'active.json');
  const relative = path.relative(rootDir, activePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`active 指针不能指向插件根目录外: ${pluginId}`);
  }
  fs.rmSync(activePath, { force: true });
}

function failed(
  pluginId: PluginId,
  version: string | null,
  error: unknown,
): BundledPluginInstallResult {
  return {
    status: 'failed',
    pluginId,
    version,
    error: readErrorMessage(error),
  };
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

  try {
    stateService.setInstalled(options.pluginId, true, options.knownPlugins);
    const upgradePlan = options.resolveUpgradePlan({
      pluginId: candidate.pluginId,
      version: candidate.version,
      pluginDir: candidate.pluginDir,
      appVersion: options.appVersion,
    });
    const activationResult = activatePluginVersionWithMigrations({
      db: options.db,
      userPluginRoot: options.userPluginRoot,
      pluginId: candidate.pluginId,
      version: candidate.version,
      appVersion: options.appVersion,
      upgradePlan,
      recordDiagnostic: options.recordDiagnostic,
    });
    if (activationResult.status !== 'activated') {
      throw new Error(activationResult.error);
    }

    clearPluginUserRemovedMarker(options.userPluginRoot, options.pluginId);
    return {
      status: 'installed',
      pluginId: options.pluginId,
      version: candidate.version,
      previousVersion: activationResult.previousVersion,
      restartRequired: true,
    };
  } catch (error) {
    // setInstalled(true) clears the database marker. Restore the exact pre-install
    // state if activation/migration fails, so a failed reinstall cannot auto-return.
    stateService.setInstalled(options.pluginId, false, options.knownPlugins);
    stateService.setUserRemoved(options.pluginId, previousRecord.userRemoved);
    if (previousRecord.userRemoved) {
      markPluginUserRemoved(options.userPluginRoot, options.pluginId);
    }
    if (candidate.previousVersion === null) {
      removeActivePointer(options.userPluginRoot, options.pluginId);
    }
    return failed(options.pluginId, candidate.version, error);
  }
}
