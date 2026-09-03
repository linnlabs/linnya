import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';
import type {
  PluginMigrationDatabase,
  PluginMigrationDefinition,
  PluginMigrationStatement,
} from '@plugin/backend/pluginMigration';

interface InstalledPluginMigrationRow {
  plugin_id: string;
  installed: number;
  schema_version: number;
}

interface PluginMigrationMaxRow {
  max_version: number | null;
}

export interface PluginMigrationRunResult {
  readonly pluginId: PluginId;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
}

export class PluginMigrationRunner {
  constructor(private readonly db: Database.Database) {}

  getCurrentVersion(pluginId: PluginId): number {
    return this.readCurrentVersion(pluginId);
  }

  run(
    pluginId: PluginId,
    declaredMigrations: readonly PluginMigrationDefinition[],
  ): PluginMigrationRunResult {
    const migrations = normalizeDeclaredMigrations(pluginId, declaredMigrations);
    const fromVersion = this.readCurrentVersion(pluginId);
    const latestDeclaredVersion = migrations.at(-1)?.version ?? 0;
    if (fromVersion > latestDeclaredVersion) {
      throw new Error(
        `[plugin-migration] ${pluginId} 数据库 schema 版本 v${fromVersion} 高于当前代码声明的 v${latestDeclaredVersion}`,
      );
    }
    const pending = migrations.filter((migration) => migration.version > fromVersion);

    if (pending.length === 0) {
      this.syncInstalledSchemaVersion(pluginId, fromVersion);
      return {
        pluginId,
        fromVersion,
        toVersion: fromVersion,
        appliedVersions: [],
      };
    }

    const appliedVersions: number[] = [];
    let toVersion = fromVersion;
    const migrationDb = this.createMigrationDatabase();

    const runPending = this.db.transaction(() => {
      for (const migration of pending) {
        migration.up(migrationDb);
        this.db
          .prepare(`
            INSERT INTO plugin_migrations (plugin_id, version, applied_at)
            VALUES (?, ?, ?)
          `)
          .run(pluginId, migration.version, Date.now());
        appliedVersions.push(migration.version);
        toVersion = migration.version;
      }

      this.db
        .prepare('UPDATE installed_plugins SET schema_version = ? WHERE plugin_id = ?')
        .run(toVersion, pluginId);
    });

    runPending();

    return {
      pluginId,
      fromVersion,
      toVersion,
      appliedVersions,
    };
  }

  private readCurrentVersion(pluginId: PluginId): number {
    const installedRow = this.db
      .prepare(`
        SELECT plugin_id, installed, schema_version
        FROM installed_plugins
        WHERE plugin_id = ?
      `)
      .get(pluginId) as InstalledPluginMigrationRow | undefined;

    if (!installedRow) {
      throw new Error(`插件未登记，不能执行 schema migration: ${pluginId}`);
    }
    if (installedRow.installed !== 1) {
      throw new Error(`插件未安装，不能执行 schema migration: ${pluginId}`);
    }

    const migrationRow = this.db
      .prepare(`
        SELECT MAX(version) AS max_version
        FROM plugin_migrations
        WHERE plugin_id = ?
      `)
      .get(pluginId) as PluginMigrationMaxRow | undefined;

    // 中文说明：schema_version 与 plugin_migrations 都可能来自旧阶段修复，取较大值避免重跑已收养迁移。
    return Math.max(installedRow.schema_version, migrationRow?.max_version ?? 0);
  }

  private syncInstalledSchemaVersion(pluginId: PluginId, currentVersion: number): void {
    this.db
      .prepare(`
        UPDATE installed_plugins
        SET schema_version = ?
        WHERE plugin_id = ?
          AND schema_version < ?
      `)
      .run(currentVersion, pluginId, currentVersion);
  }

  private createMigrationDatabase(): PluginMigrationDatabase {
    return {
      exec: (sql: string) => {
        this.db.exec(sql);
      },
      prepare: (sql: string): PluginMigrationStatement => {
        const statement = this.db.prepare(sql);
        return {
          get: (...params: unknown[]) => statement.get(...params),
          all: (...params: unknown[]) => statement.all(...params),
          run: (...params: unknown[]) => statement.run(...params),
        };
      },
    };
  }
}

function normalizeDeclaredMigrations(
  pluginId: PluginId,
  declaredMigrations: readonly PluginMigrationDefinition[],
): readonly PluginMigrationDefinition[] {
  let previousVersion = 0;
  for (const migration of declaredMigrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`[plugin-migration] ${pluginId} migration version 必须是正整数: ${migration.version}`);
    }
    if (migration.version <= previousVersion) {
      throw new Error(
        `[plugin-migration] ${pluginId} migration version 必须严格递增: ${previousVersion} -> ${migration.version}`,
      );
    }
    previousVersion = migration.version;
  }
  return declaredMigrations;
}
