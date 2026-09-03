/**
 * @file mindmapNodeRefViewBuilder.ts
 * @description MindMap 文档的 NodeRef View 构建器（纯函数）
 *
 * 职责：
 * - 将 MindMapData 转换为带 [#nodeRef] 的缩进大纲文本（供 Agent 工具链定位使用）
 * - 同步构建 UI 大纲（只含节点文本 + 层级，不暴露 ref / tagging / 版本号）
 *
 * 输出格式符合 MindMap NodeRef View 规范：
 * - 每行以 [#nodeRef] 开头，后跟节点 topic
 * - 缩进使用 2 空格，表示层级关系
 * - root 行可加 (Root) 便于理解
 */

import type { MindMapData } from '@plugin/mindmap/shared';
import { generateRefMapWithCollisionCheck } from '@plugin/backend/blockReferenceRuntime';
import type { WorkspaceDocumentReadOutlineItem } from '@app/schemas';

// ============================================================================
// 类型安全的工具函数（避免 any / 类型断言）
// ============================================================================

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const readString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

const readChildren = (node: Record<string, unknown>): Array<Record<string, unknown>> => {
  const raw = node.children;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
};

/** NodeRef View 构建结果 */
export type MindMapNodeRefViewResult = {
  observationText: string;
  uiOutline: WorkspaceDocumentReadOutlineItem[];
};

/** UI 限制参数 */
export type MindMapUiLimits = {
  uiMaxNodes: number;
  uiMaxChars: number;
};

/**
 * 构建 MindMap 的 NodeRef View（带 [#nodeRef] 的缩进大纲）
 *
 * @param content - MindMap 内容
 * @param documentId - 文档 ID（用于日志）
 * @param versionNumber - 版本号
 * @param uiLimits - UI 输出限制参数
 */
export function buildMindMapNodeRefView(
  content: MindMapData,
  _documentId: string,
  versionNumber: number,
  uiLimits: MindMapUiLimits
): MindMapNodeRefViewResult {
  const root = content.nodeData;

  // 第一遍：收集所有 nodeId
  const nodeIds: string[] = [];
  const collectNodeIds = (node: Record<string, unknown>) => {
    const id = readString(node.id);
    if (id) nodeIds.push(id);
    for (const child of readChildren(node)) collectNodeIds(child);
  };
  collectNodeIds(root);

  // 批量生成 ref（带碰撞检测）
  const refMap = generateRefMapWithCollisionCheck(nodeIds);

  // 第二遍：构建缩进大纲
  const lines: string[] = [];
  const uiOutline: WorkspaceDocumentReadOutlineItem[] = [];
  let uiCharCount = 0;

  const tryPushUiOutline = (item: WorkspaceDocumentReadOutlineItem): boolean => {
    if (uiOutline.length >= uiLimits.uiMaxNodes) return false;
    // uiMaxChars 用于粗略限制 data 体积（按 topic 文本累加）
    const nextChars = item.text.length + 1;
    if (uiCharCount + nextChars > uiLimits.uiMaxChars) return false;
    uiOutline.push(item);
    uiCharCount += nextChars;
    return true;
  };

  const walk = (node: Record<string, unknown>, depth: number, isRoot: boolean) => {
    const id = readString(node.id);
    const topic = readString(node.topic);
    if (!id || !topic) {
      throw new Error('MindMap document contains a node without canonical id or topic');
    }
    const children = readChildren(node);
    const hasChildren = children.length > 0;
    const ref = refMap.get(id);
    if (!ref) {
      throw new Error(`MindMap ref map is missing node: ${id}`);
    }
    const indent = '  '.repeat(depth);
    const rootSuffix = isRoot ? ' (Root)' : '';
    const taggingSuffix = buildTaggingSuffix(node);

    lines.push(`${indent}[${ref}] ${topic}${rootSuffix}${taggingSuffix}`);

    // 同步构建 UI 大纲（只保留节点内容，不暴露 ref/tagging/version）
    // 若达到限制则停止写入（避免 payload 膨胀）；observation 仍会完整输出
    tryPushUiOutline({ id, depth, text: topic, hasChildren });

    for (const child of children) walk(child, depth + 1, false);
  };

  walk(root, 0, true);

  const header = [
    `versionNumber: ${versionNumber}`,
    `nodeCount: ${nodeIds.length}`,
    '---'
  ].join('\n');

  return {
    observationText: header + '\n' + lines.join('\n'),
    uiOutline
  };
}

/**
 * @deprecated 使用 buildMindMapNodeRefView 替代
 */
export function buildMindMapObservation(content: MindMapData): string {
  const root = content?.nodeData;
  const rootTopic = typeof root?.topic === 'string' ? root.topic : '未命名';
  const children = Array.isArray(root?.children) ? root.children : [];
  const childTopics = children
    .map((child: unknown) => {
      if (!child || typeof child !== 'object') return '未命名节点';
      const c = child as Record<string, unknown>;
      const topic = c.topic;
      return typeof topic === 'string' && topic.trim().length > 0 ? topic : '未命名节点';
    })
    .filter(Boolean)
    .slice(0, 20);

  return [
    `思维导图根节点: ${rootTopic}`,
    `一级节点(${children.length}): ${childTopics.join(', ') || '无'}`
  ].join('\n');
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 从节点对象提取 tagging 信息（仅在存在时输出，避免 token 膨胀）
 *
 * 输出格式（稳定、可机器解析）：
 * - status/confidence/kind 仅在存在时输出
 * - kind 来自 node.tagging.labels.kind（手动语义类型）
 *
 * 示例：⟦status=refuted conf=high kind=hypothesis⟧
 */
function buildTaggingSuffix(node: Record<string, unknown>): string {
  const tagging = node.tagging && typeof node.tagging === 'object'
    ? (node.tagging as Record<string, unknown>)
    : null;
  if (!tagging) return '';

  const parts: string[] = [];

  const status = tagging.status;
  if (typeof status === 'string' && status.trim().length > 0) {
    parts.push(`status=${status}`);
  }

  const confidence = tagging.confidence;
  if (typeof confidence === 'string' && confidence.trim().length > 0) {
    parts.push(`conf=${confidence}`);
  } else if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    parts.push(`conf=${confidence}`);
  }

  const labels = tagging.labels && typeof tagging.labels === 'object'
    ? (tagging.labels as Record<string, unknown>)
    : null;
  const kind = labels ? labels.kind : undefined;
  if (typeof kind === 'string' && kind.trim().length > 0) {
    parts.push(`kind=${kind}`);
  }

  if (parts.length === 0) return '';
  return ` ⟦${parts.join(' ')}⟧`;
}
