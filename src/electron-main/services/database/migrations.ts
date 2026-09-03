/**
 * @file src/electron-main/services/database/migrations.ts
 * @description 数据库迁移执行器
 *
 * 职责：
 * - 从 migrations/ 目录加载当前基线之后的迁移函数
 * - 拒绝不属于受支持 Host Schema 范围的数据库
 * - 执行受支持的增量迁移（基于 PRAGMA user_version）
 * - 每个迁移在独立事务中执行，失败自动回滚
 *
 * 详细文档见 migrations/README.md
 */

import type Database from 'better-sqlite3';
import { HOST_SCHEMA_BASELINE_VERSION, SCHEMA_VERSION, migrations } from './migrations/index';

export { HOST_SCHEMA_BASELINE_VERSION, SCHEMA_VERSION, migrations };
export type { HostSchemaMigration, MigrationFunction } from './migrations/types';

export function assertSupportedHostSchemaVersion(currentVersion: number): void {
  if (currentVersion < HOST_SCHEMA_BASELINE_VERSION) {
    throw new Error(
      `[DatabaseService] workspace.sqlite schema v${currentVersion} 早于当前支持的 Host Schema 基线 ` +
        `v${HOST_SCHEMA_BASELINE_VERSION}。本开发基线不提供 v1-v60 兼容迁移，数据库尚未被修改。` +
        '默认开发数据请先停止应用，再执行 pnpm run dev:data:reset；其他 Workspace 需要显式重建或导入。'
    );
  }

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `[DatabaseService] workspace.sqlite schema v${currentVersion} 新于当前应用支持的 ` +
        `v${SCHEMA_VERSION}。数据库尚未被修改，请使用匹配或更新的应用版本。`
    );
  }
}

/**
 * 执行数据库迁移
 * @param db - better-sqlite3 数据库实例
 * @param currentVersion - 当前数据库版本
 * @param targetVersion - 目标版本
 */
export function runMigrations(
  db: Database.Database,
  currentVersion: number,
  targetVersion: number
): void {
  if (currentVersion >= targetVersion) {
    console.log(`[Migration] Database is up-to-date. Version: v${currentVersion}`);
    return;
  }

  console.log(`[Migration] Starting migration from v${currentVersion} to v${targetVersion}`);

  for (let version = currentVersion; version < targetVersion; version++) {
    const migration = migrations.find(candidate => candidate.fromVersion === version);

    if (!migration) {
      throw new Error(`[Migration] Missing migration function for v${version} -> v${version + 1}`);
    }

    console.log(`[Migration] Executing migration: v${version} -> v${version + 1}`);

    try {
      const transaction = db.transaction(() => {
        migration.migrate(db);
        db.pragma(`user_version = ${version + 1}`);
      });
      transaction();
      console.log(`[Migration] ✅ Successfully migrated to v${version + 1}`);
    } catch (error) {
      console.error(`[Migration] ❌ Migration failed at v${version} -> v${version + 1}:`, error);
      throw new Error(
        `Database migration failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(`[Migration] 🎉 All migrations complete! Current version: v${targetVersion}`);
}
