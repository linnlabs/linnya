/**
 * @file project-knowledge-base-links-ipc.ts
 * @description 项目-知识库关联管理的 IPC 处理器
 * 
 * 提供前端调用的 IPC 接口，用于管理项目与知识库的关联关系
 */

import { ProjectKnowledgeBaseLinksService } from '../../../../features/knowledge-base/infrastructure/sqlite/project-knowledge-base-links.service';
import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';

/**
 * 注册项目-知识库关联相关的 IPC 处理器
 */
export function registerProjectKnowledgeBaseLinksHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  console.log('[IPC] 注册项目-知识库关联 IPC 处理器...');

  // 获取 App Server Backend 已初始化的服务实例。
  const getService = (): ProjectKnowledgeBaseLinksService => {
    const service = runtimeOwner.getProjectKnowledgeBaseLinksService();
    if (!service) {
      throw new Error('ProjectKnowledgeBaseLinksService 未初始化');
    }
    return service;
  };

  /**
   * 关联知识库到项目
   */
  ipcMain.handle(
    'project-kb-links:link',
    async (
      _event,
      projectId: string,
      kbId: string,
      role?: 'read_only' | 'read_write'
    ) => {
      try {
        const service = getService();
        await service.linkKnowledgeBaseToProject(projectId, kbId, role);
        return { success: true };
      } catch (error) {
        console.error('[IPC] project-kb-links:link 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 解除项目与知识库的关联
   */
  ipcMain.handle(
    'project-kb-links:unlink',
    async (_event, projectId: string, kbId: string) => {
      try {
        const service = getService();
        const result = await service.unlinkKnowledgeBaseFromProject(projectId, kbId);
        return { success: true, deleted: result };
      } catch (error) {
        console.error('[IPC] project-kb-links:unlink 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 获取项目关联的所有知识库ID
   */
  ipcMain.handle(
    'project-kb-links:list-kb-ids',
    async (_event, projectId: string) => {
      try {
        const service = getService();
        const kbIds = await service.listKnowledgeBasesForProject(projectId);
        return { success: true, data: kbIds };
      } catch (error) {
        console.error('[IPC] project-kb-links:list-kb-ids 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 获取项目关联的所有知识库详细信息
   */
  ipcMain.handle(
    'project-kb-links:list-kb-details',
    async (_event, projectId: string) => {
      try {
        const service = getService();
        const knowledgeBases = await service.listDetailedKnowledgeBasesForProject(projectId);
        return { success: true, data: knowledgeBases };
      } catch (error) {
        console.error('[IPC] project-kb-links:list-kb-details 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 获取使用某个知识库的所有项目ID
   */
  ipcMain.handle(
    'project-kb-links:list-project-ids',
    async (_event, kbId: string) => {
      try {
        const service = getService();
        const projectIds = await service.listProjectsForKnowledgeBase(kbId);
        return { success: true, data: projectIds };
      } catch (error) {
        console.error('[IPC] project-kb-links:list-project-ids 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 获取使用某个知识库的所有项目详细信息
   */
  ipcMain.handle(
    'project-kb-links:list-project-details',
    async (_event, kbId: string) => {
      try {
        const service = getService();
        const projects = await service.listDetailedProjectsForKnowledgeBase(kbId);
        return { success: true, data: projects };
      } catch (error) {
        console.error('[IPC] project-kb-links:list-project-details 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 获取关联详情
   */
  ipcMain.handle(
    'project-kb-links:get-link-detail',
    async (_event, projectId: string, kbId: string) => {
      try {
        const service = getService();
        const link = await service.getLinkDetail(projectId, kbId);
        return { success: true, data: link };
      } catch (error) {
        console.error('[IPC] project-kb-links:get-link-detail 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 批量关联知识库
   */
  ipcMain.handle(
    'project-kb-links:link-multiple',
    async (
      _event,
      projectId: string,
      kbIds: string[],
      role?: 'read_only' | 'read_write'
    ) => {
      try {
        const service = getService();
        const count = await service.linkMultipleKnowledgeBases(projectId, kbIds, role);
        return { success: true, count };
      } catch (error) {
        console.error('[IPC] project-kb-links:link-multiple 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 检查是否已关联
   */
  ipcMain.handle(
    'project-kb-links:is-linked',
    async (_event, projectId: string, kbId: string) => {
      try {
        const service = getService();
        const isLinked = await service.isKnowledgeBaseLinkedToProject(projectId, kbId);
        return { success: true, data: isLinked };
      } catch (error) {
        console.error('[IPC] project-kb-links:is-linked 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 清理项目的所有关联
   */
  ipcMain.handle(
    'project-kb-links:clear-project',
    async (_event, projectId: string) => {
      try {
        const service = getService();
        const count = await service.clearProjectLinks(projectId);
        return { success: true, count };
      } catch (error) {
        console.error('[IPC] project-kb-links:clear-project 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  /**
   * 清理知识库的所有关联
   */
  ipcMain.handle(
    'project-kb-links:clear-kb',
    async (_event, kbId: string) => {
      try {
        const service = getService();
        const count = await service.clearKnowledgeBaseLinks(kbId);
        return { success: true, count };
      } catch (error) {
        console.error('[IPC] project-kb-links:clear-kb 失败:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  console.log('[IPC] ✅ 项目-知识库关联 IPC 处理器注册完成');
}
