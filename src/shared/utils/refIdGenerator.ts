import { refIdFromDigest, BLOCK_REF_PREFIX as REF_PREFIX, type RefIdOptions } from '@app/schemas';
export { normalizeRef, stripRefPrefix, isValidRef, type RefIdOptions } from '@app/schemas';
/**
 * @file refIdGenerator.ts
 * @description 块引用 ID（ref）生成器
 *
 * 核心设计：
 * - ref 是从 blockId(UUID) 确定性计算出的短引用 ID
 * - 格式：`#` + 6位 Base62 字符（例如 `#aZ3kP9`）
 * - 目标：跨会话可复现、不依赖内存快照、不落库
 * - 碰撞策略：文档内检测冲突时显式报错（概率极低）
 */

import * as crypto from 'crypto';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * ref 生成选项
 */


/**
 * ref 碰撞检测结果
 */
export interface RefCollisionCheckResult {
  /**
   * 是否有冲突
   */
  hasCollision: boolean;

  /**
   * 冲突的 blockId 列表（如果有）
   */
  conflictingBlockIds?: string[];

  /**
   * 冲突的 ref
   */
  conflictingRef?: string;
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 从 blockId 生成确定性的短引用 ID
 *
 * @param blockId - 块的 UUID（例如 `550e8400-e29b-41d4-a716-446655440000`）
 * @param options - 生成选项
 * @returns ref（例如 `#aZ3kP9`）
 *
 * @example
 * ```ts
 * const ref = generateRefId('550e8400-e29b-41d4-a716-446655440000');
 * // => '#aZ3kP9'
 * ```
 */
export function generateRefId(blockId: string, options: RefIdOptions = {}): string {
  return refIdFromDigest(crypto.createHash('sha256').update(blockId).digest(), options);
}

/**
 * 从哈希值生成指定长度的 Base62 字符串
 *
 * @param hash - 哈希值（Buffer）
 * @param length - 目标长度
 * @returns Base62 字符串
 */


/**
 * 批量生成 ref，并检测文档内是否有碰撞
 *
 * @param blockIds - blockId 列表
 * @param options - 生成选项
 * @returns Map<blockId, ref>
 * @throws 如果检测到碰撞，抛出错误
 *
 * @example
 * ```ts
 * const refMap = generateRefMapWithCollisionCheck([
 *   '550e8400-e29b-41d4-a716-446655440000',
 *   '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
 * ]);
 * // => Map { '550e8400-...' => '#aZ3kP9', '6ba7b810-...' => '#mT8qX2' }
 * ```
 */
export function generateRefMapWithCollisionCheck(
  blockIds: string[],
  options: RefIdOptions = {}
): Map<string, string> {
  const refMap = new Map<string, string>();
  const refToBlockIds = new Map<string, string[]>();

  // 生成所有 ref
  for (const blockId of blockIds) {
    const ref = generateRefId(blockId, options);
    refMap.set(blockId, ref);

    // 记录 ref -> blockIds 的反向映射（用于检测碰撞）
    const existing = refToBlockIds.get(ref) || [];
    existing.push(blockId);
    refToBlockIds.set(ref, existing);
  }

  // 检测碰撞
  for (const [ref, blockIdsForRef] of refToBlockIds.entries()) {
    if (blockIdsForRef.length > 1) {
      throw new Error(
        `[refIdGenerator] 检测到 ref 碰撞: ${ref} 对应了 ${blockIdsForRef.length} 个不同的 blockId: ${blockIdsForRef.join(', ')}。这是极低概率事件，请重新读取文档或联系开发者。`
      );
    }
  }

  return refMap;
}

/**
 * 从 ref 查找对应的 blockId（需要提供候选 blockIds）
 *
 * @param ref - 目标 ref（例如 `#aZ3kP9` 或 `aZ3kP9`）
 * @param blockIds - 候选 blockId 列表（通常是当前文档的所有块）
 * @param options - 生成选项
 * @returns 匹配的 blockId，如果找不到返回 null
 *
 * @example
 * ```ts
 * const blockId = resolveBlockIdFromRef('#aZ3kP9', [
 *   '550e8400-e29b-41d4-a716-446655440000',
 *   '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
 * ]);
 * // => '550e8400-e29b-41d4-a716-446655440000'
 * ```
 */
export function resolveBlockIdFromRef(
  ref: string,
  blockIds: string[],
  options: RefIdOptions = {}
): string | null {
  // 规范化 ref（去掉前缀）
  const normalizedRef = ref.startsWith(REF_PREFIX) ? ref.slice(1) : ref;

  // 遍历候选 blockIds，找到匹配的
  for (const blockId of blockIds) {
    const candidateRef = generateRefId(blockId, { ...options, includePrefix: false });
    if (candidateRef === normalizedRef) {
      return blockId;
    }
  }

  return null;
}

/**
 * 检测 ref 在给定的 blockIds 中是否有碰撞
 *
 * @param ref - 目标 ref
 * @param blockIds - 候选 blockId 列表
 * @param options - 生成选项
 * @returns 碰撞检测结果
 */
export function checkRefCollision(
  ref: string,
  blockIds: string[],
  options: RefIdOptions = {}
): RefCollisionCheckResult {
  const normalizedRef = ref.startsWith(REF_PREFIX) ? ref.slice(1) : ref;
  const matches: string[] = [];

  for (const blockId of blockIds) {
    const candidateRef = generateRefId(blockId, { ...options, includePrefix: false });
    if (candidateRef === normalizedRef) {
      matches.push(blockId);
    }
  }

  if (matches.length > 1) {
    return {
      hasCollision: true,
      conflictingBlockIds: matches,
      conflictingRef: REF_PREFIX + normalizedRef
    };
  }

  return { hasCollision: false };
}

