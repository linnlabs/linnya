import type Database from 'better-sqlite3';
import type { PluginDiagnosticLevel, PluginId } from '@app/schemas';
import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';
import { compareDottedVersions } from '../../functions/comparePluginVersions';
import { PluginDataBackup } from './plugin-data-backup';
import { PluginMigrationRunner, type PluginMigrationRunResult } from './plugin-migration.runner';

interface InstalledPluginUpgradeRow {
  plugin_id: string;
  version: string;
  installed: number;
}

interface SqliteTableNameRow {
  name: string;
}

export interface PluginUpgradePlan {
  readonly pluginId: PluginId;
  readonly targetVersion: string;
  readonly compatMin?: string;
  readonly ownedTables: readonly string[];
  readonly migrations: readonly PluginMigrationDefinition[];
}

export interface PluginUpgradeDiagnostic {
  readonly level: PluginDiagnosticLevel;
  readonly pluginId: PluginId | null;
  readonly capability: 'migration';
  readonly message: string;
}

export interface PluginUpgradeRunnerOptions {
  readonly appVersion: string;
  readonly recordDiagnostic?: (diagnostic: PluginUpgradeDiagnostic) => void;
}

export interface PluginUpgradeTransactionContext {
  readonly pluginId: PluginId;
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly migrationResult: PluginMigrationRunResult;
}

export interface PluginUpgradeRunOptions {
  /**
   * 中文说明：需要和插件版本账本同事务提交的宿主侧状态写入放这里。
   * 例如 runtime active artifact 的 activating 记录必须跟 installed_plugins.version
   * 一起提交，否则进程在两次写入之间崩溃会留下不可 reconcile 的撕裂窗口。
   */
  readonly beforeCommit?: (context: PluginUpgradeTransactionContext) => void;
}

export type PluginUpgradeRunResult =
  | {
      readonly status: 'skipped';
      readonly pluginId: PluginId;
      readonly reason: 'not-installed' | 'current';
      readonly version: string;
      readonly schemaVersion: number;
    }
  | {
      readonly status: 'incompatible';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly targetVersion: string;
      readonly reason: string;
    }
  | {
      readonly status: 'upgraded';
      readonly pluginId: PluginId;
      readonly fromVersion: string;
      readonly toVersion: string;
      readonly migrationResult: PluginMigrationRunResult;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly fromVersion: string;
      readonly targetVersion: string;
      readonly error: string;
    };

export class PluginUpgradeRunner {
  private readonly backup: PluginDataBackup;
  private readonly migrations: PluginMigrationRunner;

  constructor(
    private readonly db: Database.Database,
    private readonly options: PluginUpgradeRunnerOptions,
  ) {
    this.backup = new PluginDataBackup(db);
    this.migrations = new PluginMigrationRunner(db);
  }

  run(plan: PluginUpgradePlan, runOptions: PluginUpgradeRunOptions = {}): PluginUpgradeRunResult {
    const installed = this.readInstalledPlugin(plan.pluginId);
    if (!installed || installed.installed !== 1) {
      return {
        status: 'skipped',
        pluginId: plan.pluginId,
        reason: 'not-installed',
        version: installed?.version ?? plan.targetVersion,
        schemaVersion: 0,
      };
    }

    const compatFailure = this.readCompatFailure(plan);
    if (compatFailure) {
      this.recordDiagnostic('warn', plan.pluginId, compatFailure);
      return {
        status: 'incompatible',
        pluginId: plan.pluginId,
        version: installed.version,
        targetVersion: plan.targetVersion,
        reason: compatFailure,
      };
    }

    const versionComparison = compareDottedVersions(installed.version, plan.targetVersion);
    if (versionComparison === null) {
      const message = `无法比较插件版本，跳过升级: installed=${installed.version}, target=${plan.targetVersion}`;
      this.recordDiagnostic('warn', plan.pluginId, message);
      return {
        status: 'incompatible',
        pluginId: plan.pluginId,
        version: installed.version,
        targetVersion: plan.targetVersion,
        reason: message,
      };
    }
    if (versionComparison > 0) {
      const message = `插件已安装版本 ${installed.version} 高于当前内置版本 ${plan.targetVersion}，跳过升级`;
      this.recordDiagnostic('error', plan.pluginId, message);
      return {
        status: 'incompatible',
        pluginId: plan.pluginId,
        version: installed.version,
        targetVersion: plan.targetVersion,
        reason: message,
      };
    }

    let currentSchemaVersion: number;
    try {
      currentSchemaVersion = this.migrations.getCurrentVersion(plan.pluginId);
    } catch (error) {
      const message = `读取插件 schema 版本失败: ${toErrorMessage(error)}`;
      this.recordDiagnostic('error', plan.pluginId, message);
      return {
        status: 'failed',
        pluginId: plan.pluginId,
        fromVersion: installed.version,
        targetVersion: plan.targetVersion,
        error: message,
      };
    }

    const latestDeclaredSchemaVersion = plan.migrations[plan.migrations.length - 1]?.version ?? 0;
    if (currentSchemaVersion > latestDeclaredSchemaVersion) {
      const message = `插件数据库 schema 版本 v${currentSchemaVersion} 高于当前代码声明的 v${latestDeclaredSchemaVersion}`;
      this.recordDiagnostic('error', plan.pluginId, message);
      return {
        status: 'failed',
        pluginId: plan.pluginId,
        fromVersion: installed.version,
        targetVersion: plan.targetVersion,
        error: message,
      };
    }

    const hasPendingMigration = latestDeclaredSchemaVersion > currentSchemaVersion;
    console.log(
      `[PluginUpgradeRunner] ${plan.pluginId}: installed=${installed.version}, target=${plan.targetVersion}, `
      + `schema=${currentSchemaVersion}->${latestDeclaredSchemaVersion}, pending=${hasPendingMigration ? 'yes' : 'no'}, `
      + `ownedTables=${plan.ownedTables.length}`,
    );

    if (versionComparison === 0 && !hasPendingMigration) {
      const missingOwnedTables = this.readMissingOwnedTables(plan.ownedTables);
      if (missingOwnedTables.length > 0) {
        const message = `插件 ownedTables 声明的表不存在: ${plan.pluginId}/${missingOwnedTables.join(',')}`;
        this.recordDiagnostic('error', plan.pluginId, message);
        return {
          status: 'failed',
          pluginId: plan.pluginId,
          fromVersion: installed.version,
          targetVersion: plan.targetVersion,
          error: message,
        };
      }
      let migrationResult: PluginMigrationRunResult;
      try {
        migrationResult = this.migrations.run(plan.pluginId, plan.migrations);
      } catch (error) {
        const message = `插件迁移账本同步失败: ${toErrorMessage(error)}`;
        this.recordDiagnostic('error', plan.pluginId, message);
        return {
          status: 'failed',
          pluginId: plan.pluginId,
          fromVersion: installed.version,
          targetVersion: plan.targetVersion,
          error: message,
        };
      }
      return {
        status: 'skipped',
        pluginId: plan.pluginId,
        reason: 'current',
        version: installed.version,
        schemaVersion: migrationResult.toVersion,
      };
    }

    let migrationResult: PluginMigrationRunResult | null = null;
    const upgrade = this.db.transaction(() => {
      // 中文说明：只能快照“升级前已经存在”的表。插件 manifest 的 ownedTables
      // 描述的是目标版本全集，pending migration 合法地可以新增 owned table；
      // 若在迁移前按目标全集 fail-fast，会把“即将由 migration 创建的新表”
      // 误判成结构漂移，导致老库永远升不上来。迁移跑完后再校验全集存在，
      // 仍能守住 ownedTables 契约。
      const existingOwnedTables = currentSchemaVersion > 0
        ? this.readExistingOwnedTables(plan.ownedTables)
        : [];
      const missingBeforeMigration = plan.ownedTables.filter((tableName) => !existingOwnedTables.includes(tableName));
      if (missingBeforeMigration.length > 0) {
        console.log(
          `[PluginUpgradeRunner] ${plan.pluginId}: ${missingBeforeMigration.length} owned table(s) `
          + `will be created or verified by pending migrations: ${missingBeforeMigration.join(',')}`,
        );
      }
      const snapshot = currentSchemaVersion > 0
        ? this.backup.snapshot(plan.pluginId, existingOwnedTables)
        : null;
      migrationResult = this.migrations.run(plan.pluginId, plan.migrations);
      this.assertOwnedTablesExist(plan);
      this.db
        .prepare('UPDATE installed_plugins SET version = ? WHERE plugin_id = ?')
        .run(plan.targetVersion, plan.pluginId);
      runOptions.beforeCommit?.({
        pluginId: plan.pluginId,
        fromVersion: installed.version,
        targetVersion: plan.targetVersion,
        migrationResult,
      });
      if (snapshot) {
        this.backup.discard(snapshot);
      }
    });

    try {
      upgrade();
    } catch (error) {
      const message = `插件升级失败，已回滚: ${toErrorMessage(error)}`;
      this.recordDiagnostic('error', plan.pluginId, message);
      return {
        status: 'failed',
        pluginId: plan.pluginId,
        fromVersion: installed.version,
        targetVersion: plan.targetVersion,
        error: message,
      };
    }

    if (!migrationResult) {
      const message = '插件升级流程未返回迁移结果';
      this.recordDiagnostic('error', plan.pluginId, message);
      return {
        status: 'failed',
        pluginId: plan.pluginId,
        fromVersion: installed.version,
        targetVersion: plan.targetVersion,
        error: message,
      };
    }

    return {
      status: 'upgraded',
      pluginId: plan.pluginId,
      fromVersion: installed.version,
      toVersion: plan.targetVersion,
      migrationResult,
    };
  }

  private readInstalledPlugin(pluginId: PluginId): InstalledPluginUpgradeRow | null {
    const row = this.db
      .prepare(`
        SELECT plugin_id, version, installed
        FROM installed_plugins
        WHERE plugin_id = ?
      `)
      .get(pluginId) as InstalledPluginUpgradeRow | undefined;
    return row ?? null;
  }

  private readExistingOwnedTables(ownedTables: readonly string[]): string[] {
    return ownedTables.filter((tableName) => this.tableExists(tableName));
  }

  private readMissingOwnedTables(ownedTables: readonly string[]): string[] {
    return ownedTables.filter((tableName) => !this.tableExists(tableName));
  }

  private assertOwnedTablesExist(plan: PluginUpgradePlan): void {
    const missing = this.readMissingOwnedTables(plan.ownedTables);
    if (missing.length === 0) return;
    throw new Error(`插件 ownedTables 迁移后仍缺表: ${plan.pluginId}/${missing.join(',')}`);
  }

  private tableExists(tableName: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as SqliteTableNameRow | undefined;
    return row !== undefined;
  }

  private readCompatFailure(plan: PluginUpgradePlan): string | null {
    if (!plan.compatMin) return null;
    const comparison = compareDottedVersions(this.options.appVersion, plan.compatMin);
    if (comparison === null) {
      return `无法校验插件兼容版本: app=${this.options.appVersion}, minApp=${plan.compatMin}`;
    }
    if (comparison < 0) {
      return `当前应用版本 ${this.options.appVersion} 低于插件最低要求 ${plan.compatMin}`;
    }
    return null;
  }

  private recordDiagnostic(level: PluginDiagnosticLevel, pluginId: PluginId, message: string): void {
    this.options.recordDiagnostic?.({
      level,
      pluginId,
      capability: 'migration',
      message,
    });
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
