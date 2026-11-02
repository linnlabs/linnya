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
      '这份数据由较早版本的林芽创建，当前版本无法直接升级或打开。原数据未被修改。' +
        '请退出当前应用，保留完整的数据目录和旧版应用，使用旧版继续访问；不要删除或重置原数据。' +
        `（数据格式 v${currentVersion}，当前支持 v${HOST_SCHEMA_BASELINE_VERSION}–v${SCHEMA_VERSION}）`
    );
  }

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      '这份数据由更新版本的林芽创建，当前版本无法打开。原数据未被修改。' +
        `请使用创建这份数据的版本或更新版本。（数据格式 v${currentVersion}，当前最高支持 v${SCHEMA_VERSION}）`
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
