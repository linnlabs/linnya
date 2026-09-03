/**
 * 迁移脚本入口
 * 
 * 可以通过以下方式运行：
 * 1. 启动时自动检测并运行（如果 ENABLE_DATA_MIGRATION=true）
 * 2. 通过 IPC 手动触发
 * 3. 开发环境命令行直接执行
 */

import { getDatabaseService } from '../services/database';
import { WorkspaceMigration } from './workspace-migration';
import { Logger } from '../../shared/logger';
import { isMigrationEnabled } from '../config/feature-flags';
import { readLegacyWorkspaceMigrationPaths } from './legacyWorkspaceMigrationPaths';

const logger = new Logger('RunMigration');

/**
 * 检查是否需要迁移
 * 
 * 判断依据：
 * 1. workspace.sqlite 不存在 或为空
 * 2. Documents 目录存在且有 .ablk 文件
 */
export async function shouldRunMigration(): Promise<boolean> {
  try {
    const databaseService = getDatabaseService();
    const db = databaseService.getDb();

    // 检查 workspace_nodes 表是否有数据
    const result = db.prepare('SELECT COUNT(*) as count FROM workspace_nodes').get() as { count: number };
    
    if (result.count > 0) {
      logger.info('[RunMigration] workspace.sqlite 已有数据，跳过迁移');
      return false;
    }

    logger.info('[RunMigration] workspace.sqlite 为空，需要迁移');
    return true;
  } catch (error) {
    logger.error('[RunMigration] 检查迁移状态失败:', error);
    return false;
  }
}

/**
 * 执行迁移
 */
export async function runMigration(): Promise<void> {
  logger.info('='.repeat(80));
  logger.info('[RunMigration] 🚀 启动数据迁移流程...');
  logger.info('='.repeat(80));

  try {
    // 1. 检查功能开关
    if (!isMigrationEnabled()) {
      logger.warn('[RunMigration] ⚠️  数据迁移未启用（ENABLE_DATA_MIGRATION=false）');
      logger.warn('[RunMigration] 如需迁移，请设置环境变量: ENABLE_DATA_MIGRATION=true');
      return;
    }

    // 2. 初始化数据库服务
    const databaseService = getDatabaseService();
    await databaseService.initialize();
    const db = databaseService.getDb();

    // 3. 检查是否需要迁移
    const needsMigration = await shouldRunMigration();
    if (!needsMigration) {
      logger.info('[RunMigration] 无需迁移，退出');
      return;
    }

    // 4. 执行迁移
    logger.info('[RunMigration] 开始迁移...');
    const migration = new WorkspaceMigration(db, readLegacyWorkspaceMigrationPaths());
    const result = await migration.run();

    // 5. 报告结果
    if (result.success) {
      logger.info('='.repeat(80));
      logger.info('[RunMigration] ✅ 迁移成功完成！');
      logger.info(`[RunMigration] 文档: ${result.statistics.documentsCreated}`);
      logger.info(`[RunMigration] 批注: ${result.statistics.annotationsMigrated}`);
      logger.info(`[RunMigration] 音频块: ${result.statistics.audioBlocksMigrated}`);
      logger.info(`[RunMigration] 耗时: ${(result.duration / 1000).toFixed(2)} 秒`);
      logger.info('='.repeat(80));
    } else {
      logger.warn('='.repeat(80));
      logger.warn('[RunMigration] ⚠️  迁移完成，但有错误');
      logger.warn(`[RunMigration] 错误数量: ${result.statistics.errors}`);
      logger.warn('[RunMigration] 请检查日志以获取详细信息');
      logger.warn('='.repeat(80));
      
      // 输出前 5 个错误
      result.errors.slice(0, 5).forEach((err, idx) => {
        logger.warn(`  ${idx + 1}. ${err.file}: ${err.error}`);
      });
      
      if (result.errors.length > 5) {
        logger.warn(`  ... 还有 ${result.errors.length - 5} 个错误`);
      }
    }
  } catch (error) {
    logger.error('='.repeat(80));
    logger.error('[RunMigration] ❌ 迁移过程中发生严重错误:');
    logger.error(error);
    logger.error('='.repeat(80));
    logger.error('[RunMigration] 建议：');
    logger.error('  1. 检查备份文件是否完整');
    logger.error('  2. 设置 USE_NEW_DATABASE=false 回滚到旧系统');
    logger.error('  3. 删除 workspace.sqlite 并重试');
    logger.error('='.repeat(80));
    throw error;
  }
}

/**
 * 在应用启动时自动运行（如果需要）
 */
export async function autoMigrateOnStartup(): Promise<void> {
  if (!isMigrationEnabled()) {
    return;
  }

  logger.info('[RunMigration] 检测到自动迁移开关已启用');
  
  try {
    await runMigration();
  } catch (error) {
    logger.error('[RunMigration] 自动迁移失败，应用将继续启动但可能无法正常工作');
    // 不抛出错误，允许应用继续启动
  }
}
