/**
 * Workspace IPC Handlers - 新数据库架构的 IPC 通道
 * 
 * 注意：file-handlers.js 已经被移除了！
 * 旧通道保持不变，新通道使用 'workspace:' 前缀
 */

import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';
import { WorkspaceService } from '../../../services/workspace/workspace';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { Logger } from '../../../../shared/logger';
import { isUsingNewDatabase } from '../../../config/feature-flags';
import { runMigration } from '../../../migration/run-migration';
import { createWorkspaceDocument } from '../../../../features/workspace/document-lifecycle/orchestration/createWorkspaceDocument';
import { duplicateWorkspaceDocument } from '../../../../features/workspace/document-lifecycle/orchestration/duplicateWorkspaceDocument';
import { createWorkspaceDocumentLifecycleProviderResolver } from '../../../../app-hosts/linnya/adapters/document-lifecycle/createWorkspaceDocumentLifecycleProviderResolver';
import { listWorkspaceVfsNodes } from '../../../../features/workspace/vfs/orchestration/listWorkspaceVfsNodes';
import { readWorkspaceVfsNode } from '../../../../features/workspace/vfs/orchestration/readWorkspaceVfsNode';
import { searchWorkspaceVfsNodes } from '../../../../features/workspace/vfs/orchestration/searchWorkspaceVfsNodes';
import { createWorkspaceMutationPublisher } from '../../../../features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { createWorkspaceOperationFailure } from './workspace-operation-failure';
import { WorkspaceNodeTransferRequestSchema } from '@app/schemas';
import { inspectWorkspaceNodeTransfer } from '../../../../features/workspace/node-transfer/orchestration/inspectWorkspaceNodeTransfer';
import { transferWorkspaceNode } from '../../../../features/workspace/node-transfer/orchestration/transferWorkspaceNode';

const logger = new Logger('WorkspaceIPC');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 注册所有 workspace 相关的 IPC 处理器
 * @param runtimeOwner - App Server Backend 服务协调器
 */
export function registerWorkspaceHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  // +++ 从服务管理器获取已初始化的数据库服务实例 +++
  const services = runtimeOwner.getServices();
  const databaseService = services.databaseService;
  const workspaceMutationPublisher = createWorkspaceMutationPublisher();
  
  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | DatabaseService not available from BackendRuntimeOwner');
    throw new Error('DatabaseService not available from BackendRuntimeOwner');
  }

  // ============================================================================
  // 项目管理
  // ============================================================================

  /**
   * 创建普通用户项目
   */
  ipcMain.handle('workspace:create-project', async (event, { name, description }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      // 1. 创建项目
      const projectId = workspaceService.createProject(name, description);
      logger.info(`[workspace:create-project] 项目已创建: ${projectId}`);
      
      return { success: true, data: { projectId } };
    } catch (error: unknown) {
      logger.error('[workspace:create-project] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.createFailed');
    }
  });

  /**
   * 确保默认项目存在。
   */
  ipcMain.handle('workspace:ensure-default-project', async () => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });

      const projectId = workspaceService.ensureDefaultProject();
      logger.info(`[workspace:ensure-default-project] 默认项目已就绪: ${projectId}`);

      return { success: true, data: { projectId } };
    } catch (error: unknown) {
      logger.error('[workspace:ensure-default-project] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  /**
   * 获取所有项目
   */
  ipcMain.handle('workspace:list-projects', async () => {
    try {
      if (!isUsingNewDatabase()) {
        logger.warn('➡️ [IPC-LIFECYCLE] HANDLE | New database feature is not enabled. Aborting.');
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      const projects = workspaceService.getAllProjects();
      
      return { success: true, data: { projects } };
    } catch (error: unknown) {
      logger.error('➡️ [IPC-LIFECYCLE] HANDLE | ❌❌❌ Error in workspace:list-projects:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  /**
   * 更新项目信息
   */
  ipcMain.handle('workspace:update-project', async (event, { projectId, name, description }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      workspaceService.updateProject(projectId, { name, description });
      logger.info(`[workspace:update-project] 项目已更新: ${projectId}`);
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:update-project] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.updateFailed');
    }
  });

  /**
   * 删除普通项目（永久删除）
   */
  ipcMain.handle('workspace:delete-project', async (event, { projectId }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      workspaceService.deleteProject(projectId);
      logger.info(`[workspace:delete-project] 项目已删除: ${projectId}`);
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:delete-project] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.project.operation.deleteFailed');
    }
  });

  // ============================================================================
  // 节点管理（文件树）
  // ============================================================================

  /**
   * 获取子节点（文件夹/文档列表）
   */
  ipcMain.handle('workspace:list-nodes', async (event, { parentId, projectId }) => {
    logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | Received workspace:list-nodes for projectId: ${projectId}, parentId: ${parentId}`);
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      const nodes = workspaceService.getChildNodes(parentId || null, projectId);
      logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | ✅ Found ${nodes.length} nodes.`);
      
      return { success: true, data: nodes };
    } catch (error: unknown) {
      logger.error('[workspace:list-nodes] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  /**
   * 获取 Workspace Path Layer 子节点。
   *
   * 中文说明：
   * - `list-nodes` 保留为旧的纯 workspace_nodes 入口；
   * - `list-vfs-nodes` 是正式的 VFS 树入口，只返回项目文档节点及已声明的系统视图；
   * - 对话附件和生成图片属于对话执行空间，不能在这里重新合成项目资源库节点。
   */
  ipcMain.handle(
    'workspace:list-vfs-nodes',
    async (
      _event,
      params: {
        projectId: string;
        parentId?: string | null;
        conversationId?: string | null;
        instanceId?: string | null;
        includeSystemNodes?: boolean;
      }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const nodes = await listWorkspaceVfsNodes({
          db,
          projectId: params.projectId,
          parentId: params.parentId ?? null,
          conversationId: params.conversationId ?? null,
          instanceId: params.instanceId ?? 'default',
          includeSystemNodes: params.includeSystemNodes === true,
          nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
        });

        return { success: true, data: nodes };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:list-vfs-nodes] Error:', message);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'workspace:read-vfs-node',
    async (
      _event,
      params: {
        projectId: string;
        path?: string;
        inode?: string;
        conversationId?: string | null;
        instanceId?: string | null;
        maxChars?: number;
      }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const result = await readWorkspaceVfsNode({
          db,
          projectId: params.projectId,
          path: params.path,
          inode: params.inode,
          conversationId: params.conversationId ?? null,
          instanceId: params.instanceId ?? 'default',
          maxChars: params.maxChars,
          nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
        });

        return { success: true, data: result };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:read-vfs-node] Error:', message);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'workspace:search-vfs-nodes',
    async (
      _event,
      params: {
        projectId: string;
        pattern: string;
        path?: string;
        inode?: string;
        conversationId?: string | null;
        instanceId?: string | null;
        maxResults?: number;
      }
    ) => {
      try {
        if (!isUsingNewDatabase()) {
          return { success: false, error: 'New database not enabled' };
        }

        const db = databaseService.getDb();
        const result = await searchWorkspaceVfsNodes({
          db,
          projectId: params.projectId,
          pattern: params.pattern,
          path: params.path,
          inode: params.inode,
          conversationId: params.conversationId ?? null,
          instanceId: params.instanceId ?? 'default',
          maxResults: params.maxResults,
          nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
        });

        return { success: true, data: result };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[workspace:search-vfs-nodes] Error:', message);
        return { success: false, error: message };
      }
    }
  );

  /**
   * 创建文件夹
   */
  ipcMain.handle('workspace:create-folder', async (event, { projectId, parentId, name }) => {
    logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | Received workspace:create-folder with name: ${name}`);
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      const folderId = workspaceService.createFolder(projectId, name, parentId || null);
      logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | ✅ Folder created with ID: ${folderId}`);
      
      return { success: true, data: { folderId } };
    } catch (error: unknown) {
      logger.error('[workspace:create-folder] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.createFolderFailed');
    }
  });

  /**
   * 创建文档
   */
  ipcMain.handle('workspace:create-document', async (event, { projectId, name, parentId, type: rawType = 'document' }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }
      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });
      const result = await createWorkspaceDocument({
        workspace: workspaceService,
        resolveProvider: createWorkspaceDocumentLifecycleProviderResolver({
          db,
          databaseService,
          workspaceService,
        }),
        projectId,
        name,
        parentId: parentId ?? null,
        rawType,
      });
      return { success: true, data: { documentId: result.documentId } };
    } catch (error: unknown) {
      logger.error('[workspace:create-document] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.createFileFailed');
    }
  });

  /**
   * 删除节点（软删除）
   */
  ipcMain.handle('workspace:delete-node', async (event, { nodeId }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });
      
      const deletedNodeIds = workspaceService.deleteNode(nodeId);
      
      return { success: true, data: { deletedNodeIds } };
    } catch (error: unknown) {
      logger.error('[workspace:delete-node] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.deleteFailed');
    }
  });

    /**
   * 重命名节点
   */
  ipcMain.handle('workspace:rename-node', async (event, { nodeId, newName }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });
      
      workspaceService.renameNode(nodeId, newName);
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:rename-node] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.renameFailed');
    }
  });

  /**
   * 复制节点（platform 文档与声明 duplicateDocument 能力的插件文档）
   */
  ipcMain.handle('workspace:duplicate-node', async (event, { nodeId }) => {
    logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | Received workspace:duplicate-node for nodeId: ${nodeId}`);
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });
      const result = await duplicateWorkspaceDocument({
        workspace: workspaceService,
        resolveProvider: createWorkspaceDocumentLifecycleProviderResolver({
          db,
          databaseService,
          workspaceService,
        }),
        nodeId,
      });

      logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | ✅ Node duplicated: ${nodeId} -> ${result.nodeId}`);
      return { success: true, data: { nodeId: result.nodeId } };
    } catch (error: unknown) {
      logger.error('[workspace:duplicate-node] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.duplicateFailed');
    }
  });

  /**
   * 移动节点
   */
  ipcMain.handle('workspace:move-node', async (event, { nodeId, newParentId }) => {
    logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | Received workspace:move-node - nodeId: ${nodeId}, newParentId: ${newParentId}`);
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db, {
        mutationPublisher: workspaceMutationPublisher,
      });
      
      workspaceService.moveNode(nodeId, newParentId || null);
      logger.info(`➡️ [IPC-LIFECYCLE] HANDLE | ✅ 节点移动成功`);
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:move-node] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.moveFailed');
    }
  });

  /**
   * 跨项目移动预检。Renderer 用完整子树身份判断是否需要先保存活动文档。
   */
  ipcMain.handle('workspace:inspect-node-transfer', async (_event, rawParams: unknown) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }
      const params = WorkspaceNodeTransferRequestSchema.parse(rawParams);
      const data = inspectWorkspaceNodeTransfer({
        db: databaseService.getDb(),
        ...params,
      });
      return { success: true, data };
    } catch (error: unknown) {
      logger.error('[workspace:inspect-node-transfer] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.transferFailed');
    }
  });

  /**
   * 保持节点身份，把文件或完整文件夹子树原子转移到目标项目根目录。
   */
  ipcMain.handle('workspace:transfer-node', async (_event, rawParams: unknown) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }
      const params = WorkspaceNodeTransferRequestSchema.parse(rawParams);
      const data = transferWorkspaceNode({
        db: databaseService.getDb(),
        mutationPublisher: workspaceMutationPublisher,
        ...params,
      });
      logger.info(
        `[workspace:transfer-node] 节点已从 ${data.sourceProjectId} 移动到 ${data.targetProjectId}: ${data.nodeId}`,
      );
      return { success: true, data };
    } catch (error: unknown) {
      logger.error('[workspace:transfer-node] Error:', error);
      return createWorkspaceOperationFailure(error, 'workspace.sidebar.node.transferFailed');
    }
  });

  /**
   * 通知文档已被打开
   */
  ipcMain.handle('workspace:notify-document-opened', async (event, { documentId }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: true }; // 在旧模式下静默忽略
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      
      workspaceService.notifyDocumentOpened(documentId);
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:notify-document-opened] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('workspace:get-recent-documents', async (
    _event,
    args: { limit?: number; projectId?: string | null } = {},
  ) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      const documents = workspaceService.getRecentDocuments(args.limit ?? 8, args.projectId);

      return { success: true, data: documents };
    } catch (error: unknown) {
      logger.error('[workspace:get-recent-documents] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ============================================================================
  // 统计与工具
  // ============================================================================

  /**
   * 获取指定项目的字符统计（中文按字、英文按词），用于项目首页等场景。
   */
  ipcMain.handle('workspace:get-project-char-stats', async (event, { projectId }) => {
    try {
      if (!isUsingNewDatabase()) {
        return { success: false, error: 'New database not enabled' };
      }

      if (!projectId) {
        return { success: false, error: 'projectId is required' };
      }

      const db = databaseService.getDb();
      const workspaceService = new WorkspaceService(db);
      const stats = workspaceService.getProjectCharStats(projectId);

      return { success: true, data: stats };
    } catch (error: unknown) {
      logger.error('[workspace:get-project-char-stats] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // ============================================================================
  // 迁移工具
  // ============================================================================

  /**
   * 手动触发数据迁移
   */
  ipcMain.handle('workspace:run-migration', async () => {
    try {
      logger.info('[workspace:run-migration] 手动触发数据迁移...');
      
      await runMigration();
      
      return { success: true };
    } catch (error: unknown) {
      logger.error('[workspace:run-migration] Error:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | All workspace IPC handlers registered.');
}
