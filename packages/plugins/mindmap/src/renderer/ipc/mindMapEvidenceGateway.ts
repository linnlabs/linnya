/**
 * @file apps/renderer/shared/ipc/mindMapEvidenceGateway.ts
 *
 * @brief MindMap 证据 (Evidence) IPC 网关
 */

import type { OperationResult } from '@plugin/renderer/workspaceRuntime';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import type { CitationSourceType } from '@app/schemas';

export type MindMapEvidenceSourceType = CitationSourceType;

export interface MindMapEvidence {
  id: string;
  documentId: string;
  mindmapNodeId: string;
  sourceType: MindMapEvidenceSourceType;
  sourceId: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  orderIndex: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEvidenceParams {
  documentId: string;
  mindmapNodeId: string;
  sourceType: MindMapEvidenceSourceType;
  /**
   * 同源标识规则：
   * - knowledge_base: docId#blockId
   * - web: url
   * - manual/conversation_turn: uuid
   */
  sourceId: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  note?: string;
  orderIndex?: number;
}

export interface UpdateEvidenceParams {
  id: string;
  ref?: string;
  title?: string;
  snippet?: string;
  url?: string;
  authors?: string[];
  date?: string;
  containerTitle?: string;
  note?: string;
  orderIndex?: number;
}

export interface IMindMapEvidenceGateway {
  add(params: CreateEvidenceParams): Promise<OperationResult<MindMapEvidence>>;
  update(params: UpdateEvidenceParams): Promise<OperationResult<void>>;
  remove(id: string): Promise<OperationResult<void>>;
  list(documentId: string, nodeId: string): Promise<OperationResult<MindMapEvidence[]>>;
  batchRemove(documentId: string, nodeIds: string[]): Promise<OperationResult<void>>;
  clone(documentId: string, sourceNodeId: string, targetNodeId: string): Promise<OperationResult<void>>;
  count(documentId: string, nodeIds: string[]): Promise<OperationResult<Record<string, number>>>;
  softDelete(documentId: string, nodeIds: string[]): Promise<OperationResult<void>>;
  restore(documentId: string, nodeIds: string[]): Promise<OperationResult<void>>;
  move(documentId: string, sourceNodeId: string, targetNodeId: string): Promise<OperationResult<void>>;
}

class MindMapEvidenceGatewayImpl implements IMindMapEvidenceGateway {
  private async invoke<T>(channel: string, payload: unknown): Promise<OperationResult<T>> {
    const ipcChannel = `mindmap-evidence:${channel}`;
    return invokeRendererPluginIpc<T>('mindmap', ipcChannel, payload);
  }

  add(params: CreateEvidenceParams) {
    return this.invoke<MindMapEvidence>('add', params);
  }

  update(params: UpdateEvidenceParams) {
    return this.invoke<void>('update', params);
  }

  remove(id: string) {
    return this.invoke<void>('remove', { id });
  }

  list(documentId: string, nodeId: string) {
    return this.invoke<MindMapEvidence[]>('list', { documentId, nodeId });
  }

  batchRemove(documentId: string, nodeIds: string[]) {
    return this.invoke<void>('batch-remove', { documentId, nodeIds });
  }

  clone(documentId: string, sourceNodeId: string, targetNodeId: string) {
    return this.invoke<void>('clone', { documentId, sourceNodeId, targetNodeId });
  }
  
  count(documentId: string, nodeIds: string[]) {
    return this.invoke<Record<string, number>>('count', { documentId, nodeIds });
  }

  softDelete(documentId: string, nodeIds: string[]) {
    return this.invoke<void>('soft-delete', { documentId, nodeIds });
  }

  restore(documentId: string, nodeIds: string[]) {
    return this.invoke<void>('restore', { documentId, nodeIds });
  }

  move(documentId: string, sourceNodeId: string, targetNodeId: string) {
    return this.invoke<void>('move', { documentId, sourceNodeId, targetNodeId });
  }
}

export const mindMapEvidenceGateway: IMindMapEvidenceGateway = new MindMapEvidenceGatewayImpl();
