/**
 * @file resolveMarkdownAnnotationTarget.ts
 * @description 批注目标 ref 到 Markdown blockId 的确定性解析规则
 *
 * vNext 协议（纯 ref）：
 * - 仅支持 ref -> blockId（实时计算，不依赖快照/位置索引）
 *
 * 目标：
 * - 把“ref 解析”的策略抽离出来，供批注等功能复用
 * - 不触达 DB；仅依赖 refIdGenerator 与 baseBlocks（flattenedBlocks）
 */

import { resolveBlockIdFromRef, isValidRef, normalizeRef } from '../../../../../shared/utils/refIdGenerator';
import type { FlattenedMarkdownBlock } from '../../../shared';

// ============================================================================
// 类型定义
// ============================================================================

export type ResolveBlockIdResult =
  | { status: 'ok'; resolvedId: string; from: 'ref' }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string };

/**
 * 解析参数：仅支持 ref
 */
export interface ResolveParams {
  /** vNext 协议：短引用 ID（例如 #aZ3kP9） */
  ref: string;

  /** 当前文档的所有块（用于 ref 解析和 fallback） */
  baseBlocks: readonly FlattenedMarkdownBlock[];
}

// ============================================================================
// 核心解析函数
// ============================================================================

/**
 * 解析 ref -> blockId
 *
 * 策略：
 * - 校验 ref 格式
 * - 遍历 baseBlocks，计算每个块的 ref，找到匹配的 blockId
 * - 不依赖内存快照，可跨会话复现
 *
 * @param params - 解析参数
 * @returns 解析结果
 */
export function resolveMarkdownAnnotationTarget(params: ResolveParams): ResolveBlockIdResult {
  return resolveByRef(params.ref, params.baseBlocks);
}

// ============================================================================
// 内部实现：ref 解析
// ============================================================================

/**
 * 通过 ref 解析 blockId（vNext 协议）
 *
 * @param ref - 短引用 ID（例如 `#aZ3kP9` 或 `aZ3kP9`）
 * @param baseBlocks - 当前文档的所有块
 * @returns 解析结果
 */
function resolveByRef(ref: string, baseBlocks: readonly FlattenedMarkdownBlock[]): ResolveBlockIdResult {
  // 1. 规范化 ref（确保带 `#` 前缀）
  const normalizedRef = normalizeRef(ref);

  // 2. 校验格式
  if (!isValidRef(normalizedRef)) {
    return {
      status: 'error',
      message: `ref 格式不合法: ${ref}（期望格式：# + 6位字符，例如 #aZ3kP9）`
    };
  }

  // 3. 提取所有 blockId（用于解析）
  const blockIds = baseBlocks.map((b) => b.blockId);

  // 4. 解析 ref -> blockId
  const resolvedId = resolveBlockIdFromRef(normalizedRef, blockIds);

  if (!resolvedId) {
    return {
      status: 'error',
      message: `ref ${normalizedRef} 在当前文档中找不到对应的块。可能原因：块已被删除，或文档内容已变化。请重新读取文档获取最新 ref。`
    };
  }

  return { status: 'ok', resolvedId, from: 'ref' };
}
