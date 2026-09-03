import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';

import {
  PluginUpgradeRunner,
  type PluginUpgradeDiagnostic,
  type PluginUpgradePlan,
  type PluginUpgradeRunResult,
} from '../../infrastructure/sqlite/plugin-upgrade.runner';
import {
  activatePluginVersion,
  preparePluginVersionActivation,
  type ActivatePluginVersionResult,
  type PreparePluginVersionActivationResult,
} from './activatePluginVersion';
import { PluginActiveVersionService } from '../../infrastructure/sqlite/plugin-active-version.service';

export interface ActivatePluginVersionWithMigrationsOptions {
  readonly db: Database.Database;
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly version: string;
  readonly appVersion: string;
  readonly upgradePlan: PluginUpgradePlan;
  readonly recordDiagnostic?: (diagnostic: PluginUpgradeDiagnostic) => void;
}

export type ActivatePluginVersionWithMigrationsResult =
  | {
      readonly status: 'activated';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly previousVersion: string | null;
      readonly migrationResult: PluginUpgradeRunResult;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly error: string;
      readonly activationResult?: ActivatePluginVersionResult;
      readonly activationPreflightResult?: PreparePluginVersionActivationResult;
      readonly migrationResult?: PluginUpgradeRunResult;
    };

function assertPlanMatchesActivation(options: ActivatePluginVersionWithMigrationsOptions): string | null {
  if (options.upgradePlan.pluginId !== options.pluginId) {
    return `升级计划 pluginId 不匹配: active=${options.pluginId}, plan=${options.upgradePlan.pluginId}`;
  }
  if (options.upgradePlan.targetVersion !== options.version) {
    return `升级计划版本不匹配: active=${options.version}, plan=${options.upgradePlan.targetVersion}`;
  }
  return null;
}

function isSuccessfulMigrationResult(result: PluginUpgradeRunResult): boolean {
  return result.status === 'upgraded' || (result.status === 'skipped' && result.reason === 'current');
}

function describeFailedMigrationResult(result: PluginUpgradeRunResult): string {
  switch (result.status) {
    case 'failed':
      return result.error;
    case 'incompatible':
      return result.reason;
    case 'skipped':
      return `插件升级被跳过: ${result.reason}`;
    case 'upgraded':
      return '插件升级已完成，但激活编排收到了失败分支';
  }
}

export function activatePluginVersionWithMigrations(
  options: ActivatePluginVersionWithMigrationsOptions,
): ActivatePluginVersionWithMigrationsResult {
  const planError = assertPlanMatchesActivation(options);
  if (planError) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: options.version,
      error: planError,
    };
  }

  const activationPreflightResult = preparePluginVersionActivation({
    userPluginRoot: options.userPluginRoot,
    pluginId: options.pluginId,
    version: options.version,
  });
  if (activationPreflightResult.status === 'failed') {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: options.version,
      error: activationPreflightResult.error,
      activationPreflightResult,
    };
  }

  const runner = new PluginUpgradeRunner(options.db, {
    appVersion: options.appVersion,
    recordDiagnostic: options.recordDiagnostic,
  });
  const activeVersionService = new PluginActiveVersionService(options.db);
  const migrationResult = runner.run(options.upgradePlan, {
    beforeCommit: () => {
      activeVersionService.markActivating({
        pluginId: options.pluginId,
        activeVersion: options.version,
        previousVersion: activationPreflightResult.previousVersion,
      });
    },
  });
  if (isSuccessfulMigrationResult(migrationResult)) {
    if (migrationResult.status === 'skipped') {
      activeVersionService.markActivating({
        pluginId: options.pluginId,
        activeVersion: options.version,
        previousVersion: activationPreflightResult.previousVersion,
      });
    }
    const activationResult = activatePluginVersion({
      userPluginRoot: options.userPluginRoot,
      pluginId: options.pluginId,
      version: options.version,
      expectedPreviousVersion: activationPreflightResult.previousVersion,
    });
    if (activationResult.status === 'failed') {
      activeVersionService.markFailed({
        pluginId: options.pluginId,
        activeVersion: options.version,
        previousVersion: activationPreflightResult.previousVersion,
        error: activationResult.error,
      });
      return {
        status: 'failed',
        pluginId: options.pluginId,
        version: options.version,
        error: activationResult.error,
        activationPreflightResult,
        activationResult,
        migrationResult,
      };
    }

    activeVersionService.markActive({
      pluginId: options.pluginId,
      activeVersion: options.version,
      previousVersion: activationResult.previousVersion,
    });
    return {
      status: 'activated',
      pluginId: options.pluginId,
      version: options.version,
      previousVersion: activationResult.previousVersion,
      migrationResult,
    };
  }

  return {
    status: 'failed',
    pluginId: options.pluginId,
    version: options.version,
    error: describeFailedMigrationResult(migrationResult),
    activationPreflightResult,
    migrationResult,
  };
}
