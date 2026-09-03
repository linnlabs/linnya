/**
 * @file block-history-ipc.ts
 * @description 块级版本历史的 IPC 处理器
 *
 * 提供以下 IPC 通道：
 * - block-history:list-versions       获取块的版本列表
 * - block-history:get-version         获取单个版本详情
 * - block-history:create-version      创建新版本
 * - block-history:restore-version     恢复到指定版本
 * - block-history:delete-version      删除单个版本
 */

import { BlockHistoryService, CreateBlockVersionParams } from 'src/domains/markdown';
import { Logger } from '../../../../../../shared/logger';
import { isUsingNewDatabase } from '../../../../../config/feature-flags';
import type { BackendRuntimeOwner } from '../../../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('BlockHistoryIPC');

export function registerBlockHistoryHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  const services = runtimeOwner.getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌ DatabaseService not available!');
    throw new Error('DatabaseService not available for BlockHistory handlers');
  }

  /**
   * 获取块的版本列表
   */
  ipcMain.handle(
    'block-history:list-versions',
    async (_event, { documentNodeId, targetBlockId }: { documentNodeId: string; targetBlockId: string }) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const versions = blockHistoryService.listVersions(documentNodeId, targetBlockId);

        return { success: true, data: versions };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:list-versions] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 获取单个版本详情
   */
  ipcMain.handle(
    'block-history:get-version',
    async (_event, { versionId }: { versionId: string }) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const version = blockHistoryService.getVersion(versionId);

        if (!version) {
          return { success: false, error: 'Version not found' };
        }

        return { success: true, data: version };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:get-version] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 创建新版本
   */
  ipcMain.handle(
    'block-history:create-version',
    async (_event, params: CreateBlockVersionParams) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const version = blockHistoryService.createVersion(params);

        return { success: true, data: version };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:create-version] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 恢复到指定版本
   */
  ipcMain.handle(
    'block-history:restore-version',
    async (
      _event,
      {
        documentNodeId,
        targetBlockId,
        sourceVersionId,
      }: { documentNodeId: string; targetBlockId: string; sourceVersionId: string }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const restoredVersion = blockHistoryService.restoreVersion(
          documentNodeId,
          targetBlockId,
          sourceVersionId
        );

        return { success: true, data: restoredVersion };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:restore-version] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 获取块的最新版本
   */
  ipcMain.handle(
    'block-history:get-latest-version',
    async (
      _event,
      { documentNodeId, targetBlockId }: { documentNodeId: string; targetBlockId: string }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const version = blockHistoryService.getLatestVersion(documentNodeId, targetBlockId);

        return { success: true, data: version };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:get-latest-version] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 获取块的版本数量
   */
  ipcMain.handle(
    'block-history:get-version-count',
    async (
      _event,
      { documentNodeId, targetBlockId }: { documentNodeId: string; targetBlockId: string }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const count = blockHistoryService.getVersionCount(documentNodeId, targetBlockId);

        return { success: true, data: count };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:get-version-count] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  /**
   * 删除单个历史版本
   */
  ipcMain.handle(
    'block-history:delete-version',
    async (_event, { versionId }: { versionId: string }) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const blockHistoryService = new BlockHistoryService(db);
        const changes = blockHistoryService.deleteVersion(versionId);

        if (changes === 0) {
          // 没有找到对应记录，也认为是失败，方便前端记录日志
          const message = `Version not found for delete: ${versionId}`;
          logger.warn('[block-history:delete-version] ' + message);
          return { success: false, error: message };
        }

        return { success: true, data: undefined };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[block-history:delete-version] Error:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );
}
