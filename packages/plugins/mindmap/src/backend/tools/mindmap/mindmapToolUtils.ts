/**
 * @file mindmapToolUtils.ts
 * @description MindMap 工具共享逻辑
 *
 * 中文说明：
 * - 提取 MindMap 文本大纲工具的公共逻辑
 * - 包括：节点查找、refMap 生成、版本校验等
 */

import { MindMapDocumentService, type MindMapData } from '../../persistence/mindmap_document/services/mindmap_document.service';
import type { MindMapNodeData } from '@plugin/mindmap/shared';
import { createWorkspaceService, publishWorkspaceDocumentUpdated } from '@plugin/backend/workspaceRuntime';
import {
  generateRefMapWithCollisionCheck,
  resolveBlockIdFromRef,
} from '@plugin/backend/blockReferenceRuntime';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import type { MindMapDocumentServicePort } from '../../ports/mindMapDocumentServicePort';
import { requireMindMapSqliteDatabase } from '../../persistence/ports/sqliteDatabasePort';

// ============================================================================
// 类型定义
// ============================================================================

export type MindMapNodeObj = MindMapNodeData;

/**
 * MindMap 文档上下文（工具执行时的共享状态）
 */
export interface MindMapDocContext {
  documentId: string;
  /**
   * 文档名称（workspace_nodes.name）
   *
   * 中文说明：
   * - 给 UI/工具 observation 提供更友好的显示名；
   * - 根因：如果工具只返回 documentId，前端为了显示标题会被迫再发起查询或做推断；
   * - 因此这里把 name 作为上下文的一部分，工具返回时可直接透传。
   */
  documentName: string;
  versionNumber: number;
  content: MindMapData;
  nodeData: MindMapNodeObj;
  allNodeIds: string[];
  refMap: Map<string, string>;
  mindMapService: MindMapDocumentServicePort;
}

/**
 * 节点查找结果
 */
export interface NodeFindResult {
  success: boolean;
  node?: MindMapNodeObj;
  nodeId?: string;
  error?: string;
}

// ============================================================================
// 核心工具函数
// ============================================================================

/**
 * 初始化 MindMap 文档上下文
 *
 * @param documentId - 文档 ID
 * @param context - 工具上下文
 * @returns 文档上下文或错误信息
 */
export function initMindMapDocContext(
  documentId: string,
  context: ToolContext
): { success: true; ctx: MindMapDocContext } | { success: false; error: string } {
  const databaseService = context.databaseService;
  if (!databaseService) {
    return { success: false, error: '工作区数据库不可用：工具上下文缺少 databaseService。' };
  }

  const db = requireMindMapSqliteDatabase(databaseService.getDb(), 'tool document context');
  const workspaceService = context.workspaceService ?? createWorkspaceService(db);
  const mindMapService = new MindMapDocumentService(db, workspaceService, {
    publishDocumentUpdated: publishWorkspaceDocumentUpdated,
  });

  // 获取文档
  const doc = mindMapService.getDocument(documentId);
  if (!doc) {
    return { success: false, error: `MindMap 文档不存在：${documentId}` };
  }

  // 获取文档名称（来自 workspace_nodes），供 UI 展示
  const node = workspaceService.getNode(documentId);
  const documentName =
    node && typeof node.name === 'string' && node.name.trim().length > 0 ? node.name.trim() : documentId;

  const content = doc.content;
  const nodeData = content.nodeData;

  // 收集所有 nodeId 并生成 refMap
  const allNodeIds = collectAllNodeIds(nodeData);
  const refMap = generateRefMapWithCollisionCheck(allNodeIds);

  return {
    success: true,
    ctx: {
      documentId,
      documentName,
      versionNumber: doc.versionNumber,
      content,
      nodeData,
      allNodeIds,
      refMap,
      mindMapService
    }
  };
}

/**
 * 初始化 MindMap 文档上下文（不校验版本号）
 *
 * 中文说明：
 * 收集所有节点 ID
 */
export function collectAllNodeIds(node: MindMapNodeObj): string[] {
  const ids: string[] = [];
  const collect = (n: MindMapNodeObj) => {
    if (n.id) {
      ids.push(n.id);
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        collect(child);
      }
    }
  };
  collect(node);
  return ids;
}

/**
 * 根据 nodeRef 或 nodeId 查找节点
 */
export function findNode(
  nodeData: MindMapNodeObj,
  allNodeIds: string[],
  nodeRef?: string,
  nodeId?: string
): NodeFindResult {
  let resolvedNodeId: string | null = null;

  if (nodeRef) {
    // 从 ref 解析 nodeId
    resolvedNodeId = resolveBlockIdFromRef(nodeRef, allNodeIds);
    if (!resolvedNodeId) {
      return { success: false, error: `无法解析 nodeRef: ${nodeRef}` };
    }
  } else if (nodeId) {
    resolvedNodeId = nodeId;
  } else {
    return { success: false, error: '必须提供 nodeRef 或 nodeId' };
  }

  // 校验 nodeId 与 nodeRef 一致性（如果同时提供）
  if (nodeRef && nodeId) {
    const expectedNodeId = resolveBlockIdFromRef(nodeRef, allNodeIds);
    if (expectedNodeId !== nodeId) {
      return { success: false, error: `nodeRef(${nodeRef}) 与 nodeId(${nodeId}) 不一致` };
    }
  }

  // 查找节点
  const findInTree = (n: MindMapNodeObj): MindMapNodeObj | null => {
    if (n.id === resolvedNodeId) {
      return n;
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        const found = findInTree(child);
        if (found) return found;
      }
    }
    return null;
  };

  const node = findInTree(nodeData);
  if (!node) {
    return { success: false, error: `节点不存在: ${resolvedNodeId}` };
  }

  return { success: true, node, nodeId: resolvedNodeId };
}

/**
 * 保存 MindMap 新版本
 */
export function saveMindMapVersion(
  ctx: MindMapDocContext
): { versionNumber: number } {
  const result = ctx.mindMapService.updateDocument({
    documentId: ctx.documentId,
    // 中文说明：使用读取到的版本号作为 expectedBaseVersionNumber，避免并发覆盖。
    expectedBaseVersionNumber: ctx.versionNumber,
    content: {
      ...ctx.content,
      nodeData: ctx.nodeData
    }
  });
  return { versionNumber: result.versionNumber };
}

/**
 * 构建 changedNodeRefs
 */
export function buildChangedNodeRefs(
  changedNodeIds: string[],
  refMap: Map<string, string>
): string[] {
  return changedNodeIds
    .map((id) => refMap.get(id))
    .filter((ref): ref is string => !!ref);
}
