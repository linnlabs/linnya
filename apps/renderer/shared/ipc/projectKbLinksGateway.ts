/**
 * @file projectKbLinksGateway.ts
 * @description “项目 ↔ 知识库关联关系” IPC 网关（渲染进程侧）
 *
 * 说明：
 * - 前端通过统一的 Gateway 调用 `project-kb-links:*` IPC 通道
 * - 保持与 `workspaceGateway` / `blockHistoryGateway` 一致的调用风格
 */

import type { OperationResult } from './workspaceGateway';

export type ProjectKbLinkRole = 'read_only' | 'read_write';

export interface IProjectKbLinksGateway {
  /**
   * 获取使用某个知识库的所有项目 ID
   * 对应主进程通道：`project-kb-links:list-project-ids`
   */
  listProjectIdsForKnowledgeBase(args: {
    kbId: string;
  }): Promise<OperationResult<string[]>>;

  /**
   * 获取某个项目已关联的所有知识库 ID
   * 对应主进程通道：`project-kb-links:list-kb-ids`
   */
  listKnowledgeBaseIdsForProject(args: {
    projectId: string;
  }): Promise<OperationResult<string[]>>;

  /**
   * 将某个知识库的项目关联关系“整体替换”为给定的 projectId 列表
   *
   * 实现策略：
   * - 先调用 clear-kb 清理该知识库所有关联
   * - 然后对每个 projectId 调用 link（默认角色 read_write）
   */
  replaceKnowledgeBaseProjectLinks(args: {
    kbId: string;
    projectIds: string[];
  }): Promise<OperationResult<void>>;

  /**
   * 将某个项目的知识库关联关系“整体替换”为给定的 kbId 列表
   *
   * 实现策略：
   * - 先调用 clear-project 清理该项目所有关联
   * - 然后调用 link-multiple 一次性建立新的关联
   */
  replaceProjectKnowledgeBaseLinks(args: {
    projectId: string;
    kbIds: string[];
  }): Promise<OperationResult<void>>;
}

class ProjectKbLinksGatewayImpl implements IProjectKbLinksGateway {
  /**
   * 与 preload 中暴露的 window.electronAPI 对齐的最小类型定义。
   * 这里只关心按通道名调用的函数签名，保持 unknown 以避免误用 any。
   */
  private electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>;

  constructor() {
    const globalObject = window as unknown as {
      electronAPI?: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };

    if (!globalObject.electronAPI) {
      throw new Error(
        '[ProjectKbLinksGateway] window.electronAPI is not available'
      );
    }

    this.electronAPI = globalObject.electronAPI;
  }

  /**
   * 通用 IPC 调用封装
   * @param channel 不含前缀的子通道名，例如 'list-project-ids'
   */
  private async invoke<T>(
    channel: string,
    ...args: unknown[]
  ): Promise<OperationResult<T>> {
    const ipcChannel = `project-kb-links:${channel}`;
    try {
      const handler = this.electronAPI[ipcChannel];
      if (typeof handler !== 'function') {
        throw new Error(
          `IPC channel "${ipcChannel}" is not a function on electronAPI.`
        );
      }
      const result = await handler(...args);
      return result as OperationResult<T>;
    } catch (error) {
      console.error(
        `[ProjectKbLinksGateway] IPC call to "${ipcChannel}" failed:`,
        error
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : `Unknown IPC error on channel ${ipcChannel}`
      };
    }
  }

  async listProjectIdsForKnowledgeBase(args: {
    kbId: string;
  }): Promise<OperationResult<string[]>> {
    const { kbId } = args;
    if (!kbId) {
      return {
        success: true,
        data: []
      };
    }
    return this.invoke<string[]>('list-project-ids', kbId);
  }

  async listKnowledgeBaseIdsForProject(args: {
    projectId: string;
  }): Promise<OperationResult<string[]>> {
    const { projectId } = args;
    if (!projectId) {
      return {
        success: true,
        data: []
      };
    }
    // 这里直接复用通用 invoke 封装，保持与其它方法一致
    return this.invoke<string[]>('list-kb-ids', projectId);
  }

  async replaceKnowledgeBaseProjectLinks(args: {
    kbId: string;
    projectIds: string[];
  }): Promise<OperationResult<void>> {
    const { kbId, projectIds } = args;

    if (!kbId) {
      return {
        success: false,
        error: '[ProjectKbLinksGateway] kbId 不能为空'
      };
    }

    const normalizedIds = Array.from(
      new Set(
        projectIds.filter(
          (id) => typeof id === 'string' && id.trim().length > 0
        )
      )
    );

    // 1. 先清理该知识库所有现有关联
    const clearResult = await this.invoke<unknown>('clear-kb', kbId);
    if (!clearResult.success) {
      return {
        success: false,
        error:
          clearResult.error && clearResult.error.trim().length > 0
            ? clearResult.error
            : `清理知识库 ${kbId} 关联项目失败`
      };
    }

    // 2. 如果没有要关联的项目，直接返回成功
    if (normalizedIds.length === 0) {
      return {
        success: true,
        data: undefined
      };
    }

    // 3. 逐个创建关联（默认角色 read_write）
    for (const projectId of normalizedIds) {
      const linkResult = await this.invoke<unknown>(
        'link',
        projectId,
        kbId,
        'read_write' as ProjectKbLinkRole
      );
      if (!linkResult.success) {
        return {
          success: false,
          error:
            linkResult.error && linkResult.error.trim().length > 0
              ? linkResult.error
              : `将知识库 ${kbId} 关联到项目 ${projectId} 失败`
        };
      }
    }

    return {
      success: true,
      data: undefined
    };
  }

  async replaceProjectKnowledgeBaseLinks(args: {
    projectId: string;
    kbIds: string[];
  }): Promise<OperationResult<void>> {
    const { projectId, kbIds } = args;

    if (!projectId) {
      return {
        success: false,
        error: '[ProjectKbLinksGateway] projectId 不能为空'
      };
    }

    const normalizedKbIds = Array.from(
      new Set(
        kbIds.filter(
          (id) => typeof id === 'string' && id.trim().length > 0
        )
      )
    );

    // 1. 先清理该项目所有现有关联
    const clearResult = await this.invoke<unknown>('clear-project', projectId);
    if (!clearResult.success) {
      return {
        success: false,
        error:
          clearResult.error && clearResult.error.trim().length > 0
            ? clearResult.error
            : `清理项目 ${projectId} 关联知识库失败`
      };
    }

    // 2. 如果没有要关联的知识库，直接返回成功
    if (normalizedKbIds.length === 0) {
      return {
        success: true,
        data: undefined
      };
    }

    // 3. 使用后端提供的批量关联接口建立新关联（默认角色 read_write）
    const linkMultipleResult = await this.invoke<unknown>(
      'link-multiple',
      projectId,
      normalizedKbIds,
      'read_write' as ProjectKbLinkRole
    );

    if (!linkMultipleResult.success) {
      return {
        success: false,
        error:
          linkMultipleResult.error &&
          linkMultipleResult.error.trim().length > 0
            ? linkMultipleResult.error
            : `为项目 ${projectId} 关联知识库失败`
      };
    }

    return {
      success: true,
      data: undefined
    };
  }
}

export const projectKbLinksGateway: IProjectKbLinksGateway =
  new ProjectKbLinksGatewayImpl();


