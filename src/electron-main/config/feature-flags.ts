/**
 * 功能开关 (Feature Flags)
 * 
 * 用于控制新旧系统的平滑切换，支持渐进式迁移
 * 
 * 使用方法：
 * 1. 开发环境测试新架构：
 *    USE_NEW_DATABASE=true npm run dev
 * 
 * 2. 生产环境保持旧架构：
 *    默认不设置环境变量，使用旧系统
 * 
 * 3. 回滚到旧系统：
 *    USE_NEW_DATABASE=false npm run dev
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('FeatureFlags');

export interface FeatureFlagsConfig {
  /**
   * 是否使用新的数据库架构 (workspace.sqlite)
   * 
   * - true: 使用新的 DatabaseService、WorkspaceService、MarkdownDocumentService
   * - false: 使用旧的 fileSystem.ts 和独立的 conversations.sqlite
   * 
   * 默认: false (保守策略，确保向后兼容)
   */
  USE_NEW_DATABASE: boolean;

  /**
   * 是否在使用新数据库时保留旧文件
   * 
   * - true: 旧文件完整保留，新系统只读取不修改（推荐）
   * - false: （未来功能）迁移后可能删除旧文件
   * 
   * 默认: true (安全第一)
   */
  KEEP_OLD_FILES: boolean;

  /**
   * 是否在启动时自动备份数据
   * 
   * - true: 每次启动新系统前自动备份所有数据
   * - false: 不自动备份（不推荐）
   * 
   * 默认: true (安全第一)
   */
  AUTO_BACKUP_ON_START: boolean;

  /**
   * 是否启用数据迁移（一次性操作）
   * 
   * - true: 启动时检查并执行数据迁移
   * - false: 跳过迁移（适用于已迁移的环境）
   * 
   * 默认: false (避免重复迁移)
   */
  ENABLE_DATA_MIGRATION: boolean;

}

function loadFeatureFlags(): FeatureFlagsConfig {
  const config: FeatureFlagsConfig = {
    USE_NEW_DATABASE: true, // 强制开启
    KEEP_OLD_FILES: process.env.KEEP_OLD_FILES !== 'false',
    AUTO_BACKUP_ON_START: process.env.AUTO_BACKUP_ON_START !== 'false',
    ENABLE_DATA_MIGRATION: process.env.ENABLE_DATA_MIGRATION === 'true',
  };

  logger.info('='.repeat(60));
  logger.info('[FeatureFlags] 功能开关配置:');
  logger.info(`  USE_NEW_DATABASE: ${config.USE_NEW_DATABASE}`);
  logger.info(`  KEEP_OLD_FILES: ${config.KEEP_OLD_FILES}`);
  logger.info(`  AUTO_BACKUP_ON_START: ${config.AUTO_BACKUP_ON_START}`);
  logger.info(`  ENABLE_DATA_MIGRATION: ${config.ENABLE_DATA_MIGRATION}`);
  logger.info('='.repeat(60));

  if (config.USE_NEW_DATABASE && !config.KEEP_OLD_FILES) {
    logger.warn('⚠️  警告: 新数据库已启用但 KEEP_OLD_FILES=false，这可能导致数据丢失！');
    logger.warn('⚠️  强制设置 KEEP_OLD_FILES=true 以确保安全。');
    config.KEEP_OLD_FILES = true;
  }

  return config;
}

export const FEATURE_FLAGS: FeatureFlagsConfig = loadFeatureFlags();

/**
 * 便捷函数：是否使用新数据库架构
 */
export function isUsingNewDatabase(): boolean {
  return FEATURE_FLAGS.USE_NEW_DATABASE;
}

/**
 * 便捷函数：是否保留旧文件
 */
export function shouldKeepOldFiles(): boolean {
  return FEATURE_FLAGS.KEEP_OLD_FILES;
}

/**
 * 便捷函数：是否需要自动备份
 */
export function shouldAutoBackup(): boolean {
  return FEATURE_FLAGS.AUTO_BACKUP_ON_START;
}

/**
 * 便捷函数：是否启用数据迁移
 */
export function isMigrationEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_DATA_MIGRATION;
}

/**
 * 运行时修改功能开关（仅用于测试）
 * 
 * 注意：不推荐在生产环境使用，应该重启应用以应用新配置
 */
export function updateFeatureFlag(key: keyof FeatureFlagsConfig, value: boolean): void {
  logger.warn(`[FeatureFlags] 运行时修改配置: ${key} = ${value}`);
  FEATURE_FLAGS[key] = value;
}
