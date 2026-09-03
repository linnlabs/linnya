/**
 * @file apps/renderer/shared/ipc/mindMapGateway.ts
 *
 * @brief MindMap 数据库 IPC 网关 (渲染进程侧)
 *
 * @description
 * 此模块是渲染进程与主进程 MindMap 文档通信的唯一入口。
 * 它封装了所有对 MindMap 后端插件 IPC 的调用。
 */

import type { OperationResult } from '@plugin/renderer/workspaceRuntime';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import type { MindMapData } from '../domain/types';

export type MindMapViewport = {
  x: number;
  y: number;
  scale: number;
};

export type MindMapMetadata = {
  rootTopic: string | null;
  themeName: string | null;
  layoutType: number | null;
  nodeCount: number | null;
  viewport: MindMapViewport;
  createdAt: number;
  updatedAt: number;
};

export type MindMapCreateArgs = {
  projectId: string;
  parentId?: string | null;
  name: string;
  content?: MindMapData;
};

export type MindMapReadResult = {
  content: MindMapData;
  metadata: MindMapMetadata;
};

export type MindMapUpdateArgs = {
  documentId: string;
  content: MindMapData;
  metadata?: Partial<MindMapMetadata> & { viewport?: MindMapViewport };
  expectedBaseVersionNumber?: number;
};

export type MindMapUpdateResult = {
  versionId: string;
  versionNumber: number;
};

export interface IMindMapGateway {
  'create'(args: MindMapCreateArgs): Promise<OperationResult<{ documentId: string }>>;
  'read'(args: { documentId: string }): Promise<OperationResult<MindMapReadResult>>;
  'update'(args: MindMapUpdateArgs): Promise<OperationResult<MindMapUpdateResult>>;
}

class MindMapGatewayImpl implements IMindMapGateway {
  private async invoke<T>(channel: string, payload: unknown): Promise<OperationResult<T>> {
    const ipcChannel = `mindmap-document:${channel}`;
    return invokeRendererPluginIpc<T>('mindmap', ipcChannel, payload);
  }

  'create'(args: MindMapCreateArgs): Promise<OperationResult<{ documentId: string }>> {
    return this.invoke('create', args);
  }

  'read'(args: { documentId: string }): Promise<OperationResult<MindMapReadResult>> {
    return this.invoke('read', args);
  }

  'update'(args: MindMapUpdateArgs): Promise<OperationResult<MindMapUpdateResult>> {
    return this.invoke('update', args);
  }
}

/**
 * MindMap 网关单例实例
 */
export const mindMapGateway: IMindMapGateway = new MindMapGatewayImpl();
