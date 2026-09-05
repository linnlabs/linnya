import { MindMapDocumentService } from '../../persistence/mindmap_document/services/mindmap_document.service';
import { createWorkspaceService } from '@plugin/backend/workspaceRuntime';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { publishWorkspaceDocumentUpdated } from '@plugin/backend/workspaceRuntime';
import type { BackendPluginIpcHandlerRegistrar } from '@plugin/backend/pluginContribution';
import { assertPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import { MINDMAP_PLUGIN_ID, MINDMAP_PLUGIN_META } from '@plugin/mindmap/shared';
import {
  parseCreateMindMapPayload,
  parseReadMindMapPayload,
  parseUpdateMindMapPayload,
  readErrorMessage,
} from './ipc-payloads';
import { readMindMapTsServiceManager } from './ts-service-manager';

const logger = new Logger('MindMapIPC');

function assertMindmapRuntimeEnabled(action: string): void {
  assertPluginRuntimeEnabled({
    pluginId: MINDMAP_PLUGIN_ID,
    pluginName: MINDMAP_PLUGIN_META.name,
    action,
  });
}

/**
 * 注册 MindMap 文档相关的 IPC 处理器
 */
export function registerMindMapDocumentHandlers(
  tsServiceManager: unknown,
  registerBackendPluginIpcHandler: BackendPluginIpcHandlerRegistrar,
): void {
  logger.info('🔌 [IPC-LIFECYCLE] REGISTER | Registering MindMap IPC handlers...');

  const services = readMindMapTsServiceManager(tsServiceManager).getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌❌❌ DatabaseService not available!');
    throw new Error('DatabaseService not available');
  }

  const db = databaseService.getDb();
  const workspaceService = createWorkspaceService(db);
  const mindMapService = new MindMapDocumentService(db, workspaceService, {
    publishDocumentUpdated: publishWorkspaceDocumentUpdated,
  });

  // ============================================================================
  // MindMap 文档管理
  // ============================================================================

  /**
   * 创建 MindMap 文档
   */
  registerBackendPluginIpcHandler('mindmap', 'mindmap-document:create', async (_event, payload) => {
    try {
      assertMindmapRuntimeEnabled('创建 Mindmap 文档');
      const params = parseCreateMindMapPayload(payload);

      const node = mindMapService.createDocument({
        projectId: params.projectId,
        parentId: params.parentId ?? null,
        name: params.name,
        content: params.content,
      });

      logger.info(`[mindmap-document:create] MindMap created: ${node.id}`);

      // 返回文档 ID，前端可能需要跳转
      return { success: true, data: { documentId: node.id } };
    } catch (error) {
      logger.error('[mindmap-document:create] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  /**
   * 获取 MindMap 文档内容
   */
  registerBackendPluginIpcHandler('mindmap', 'mindmap-document:read', async (_event, payload) => {
    try {
      assertMindmapRuntimeEnabled('读取 Mindmap 文档');
      const { documentId } = parseReadMindMapPayload(payload);

      const doc = mindMapService.getDocument(documentId);

      if (!doc) {
        return { success: false, error: 'Document not found' };
      }

      return { success: true, data: doc };
    } catch (error) {
      logger.error('[mindmap-document:read] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  /**
   * 更新 MindMap 文档
   */
  registerBackendPluginIpcHandler('mindmap', 'mindmap-document:update', async (_event, payload) => {
    try {
      assertMindmapRuntimeEnabled('更新 Mindmap 文档');
      const params = parseUpdateMindMapPayload(payload);

      const result = mindMapService.updateDocument(params);

      return { success: true, data: result };
    } catch (error) {
      logger.error('[mindmap-document:update] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | MindMap IPC handlers registered.');
}
