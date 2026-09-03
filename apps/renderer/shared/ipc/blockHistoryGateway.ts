/**
 * @file apps/renderer/shared/ipc/blockHistoryGateway.ts
 * @description 块级版本历史 IPC 网关
 *
 * 提供前端调用块版本历史相关 IPC 的类型安全接口
 */

import type { OperationResult } from './workspaceGateway';

// ==================== 类型定义 ====================

/** 版本来源类型 */
export type BlockVersionOriginType = 'manual' | 'ai' | 'restore';

/** 版本元数据 */
export interface BlockVersionMetadata {
  modelId?: string;
  prompt?: string;
  diffStats?: {
    insertCount: number;
    deleteCount: number;
  };
  restoredFromVersionId?: string;
}

/** 块版本记录 */
export interface BlockVersion {
  id: string;
  document_node_id: string;
  target_block_id: string;
  block_type: string;
  version_number: number;
  content_json: string;
  origin_type: BlockVersionOriginType;
  origin_metadata: string | null;
  created_at: number;
}

/** 创建版本的参数 */
export interface CreateBlockVersionParams {
  documentNodeId: string;
  targetBlockId: string;
  blockType: string;
  contentJson: string;
  originType: BlockVersionOriginType;
  originMetadata?: BlockVersionMetadata;
}

// ==================== Gateway 接口 ====================

export interface IBlockHistoryGateway {
  /** 获取块的版本列表 */
  listVersions(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<BlockVersion[]>>;

  /** 获取单个版本详情 */
  getVersion(args: { versionId: string }): Promise<OperationResult<BlockVersion>>;

  /** 创建新版本 */
  createVersion(params: CreateBlockVersionParams): Promise<OperationResult<BlockVersion>>;

  /** 恢复到指定版本 */
  restoreVersion(args: {
    documentNodeId: string;
    targetBlockId: string;
    sourceVersionId: string;
  }): Promise<OperationResult<BlockVersion>>;

  /** 获取块的最新版本 */
  getLatestVersion(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<BlockVersion | null>>;

  /** 获取块的版本数量 */
  getVersionCount(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<number>>;

  /** 删除指定版本 */
  deleteVersion(args: {
    versionId: string;
  }): Promise<OperationResult<void>>;
}

// ==================== Gateway 实现 ====================

class BlockHistoryGatewayImpl implements IBlockHistoryGateway {
  private electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>;

  constructor() {
    if (!(window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI) {
      throw new Error('[BlockHistoryGateway] window.electronAPI is not available');
    }
    this.electronAPI = (window as unknown as { electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>> }).electronAPI;
  }

  private async invoke<T>(channel: string, ...args: unknown[]): Promise<OperationResult<T>> {
    const ipcChannel = `block-history:${channel}`;
    try {
      if (typeof this.electronAPI[ipcChannel] !== 'function') {
        throw new Error(`IPC channel "${ipcChannel}" is not a function on electronAPI.`);
      }
      const result = await this.electronAPI[ipcChannel](...args);
      return result as OperationResult<T>;
    } catch (error) {
      console.error(`[BlockHistoryGateway] IPC call to "${ipcChannel}" failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : `Unknown IPC error on channel ${ipcChannel}`,
      };
    }
  }

  listVersions(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<BlockVersion[]>> {
    return this.invoke('list-versions', args);
  }

  getVersion(args: { versionId: string }): Promise<OperationResult<BlockVersion>> {
    return this.invoke('get-version', args);
  }

  createVersion(params: CreateBlockVersionParams): Promise<OperationResult<BlockVersion>> {
    return this.invoke('create-version', params);
  }

  restoreVersion(args: {
    documentNodeId: string;
    targetBlockId: string;
    sourceVersionId: string;
  }): Promise<OperationResult<BlockVersion>> {
    return this.invoke('restore-version', args);
  }

  getLatestVersion(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<BlockVersion | null>> {
    return this.invoke('get-latest-version', args);
  }

  getVersionCount(args: {
    documentNodeId: string;
    targetBlockId: string;
  }): Promise<OperationResult<number>> {
    return this.invoke('get-version-count', args);
  }

  deleteVersion(args: {
    versionId: string;
  }): Promise<OperationResult<void>> {
    return this.invoke('delete-version', args);
  }
}

// ==================== 单例导出 ====================

export const blockHistoryGateway: IBlockHistoryGateway = new BlockHistoryGatewayImpl();

// ==================== 工具函数 ====================

/**
 * 解析版本元数据
 */
export function parseBlockVersionMetadata(version: BlockVersion): BlockVersionMetadata | null {
  if (!version.origin_metadata) {
    return null;
  }
  try {
    return JSON.parse(version.origin_metadata) as BlockVersionMetadata;
  } catch {
    return null;
  }
}

