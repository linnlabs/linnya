/**
 * @file diffUtils.ts
 * @description 文本差异计算工具
 *
 * 使用 diff-match-patch 库计算文本差异，
 * 并提供将差异应用到 ProseMirror 编辑器的工具函数。
 */

// 注意：需要先安装 diff-match-patch
// npm install diff-match-patch
// npm install -D @types/diff-match-patch

// 直接使用 ESM 导入（配合 Vite / TypeScript）
import DiffMatchPatch from 'diff-match-patch'
import { logRevisionDebug, shouldLogRevisionDebug } from './revisionDebugLogging'

// ==================== 类型定义 ====================

/** Diff 结果类型 */
export type DiffType = 'equal' | 'insert' | 'delete'

/** 单个 Diff 片段 */
export interface DiffSegment {
  /** 变更类型 */
  type: DiffType
  /** 文本内容 */
  text: string
}

/** 带位置信息的 Diff 结果 */
export interface DiffResult {
  /** 变更类型 */
  type: DiffType
  /** 文本内容 */
  text: string
  /** 在原文档中的起始位置 */
  startPos: number
  /** 在原文档中的结束位置 */
  endPos: number
}

/** Diff 统计 */
export interface DiffStats {
  /** 插入的文本数量 */
  insertCount: number
  /** 删除的文本数量 */
  deleteCount: number
  /** 插入的字符数 */
  insertChars: number
  /** 删除的字符数 */
  deleteChars: number
}

// ==================== Diff 计算 ====================

function shouldLogRevisionDiffDebug(): boolean {
  return import.meta.env.DEV && shouldLogRevisionDebug()
}

function pushDiffSegment(segments: DiffSegment[], type: DiffType, text: string): void {
  if (text.length === 0) return
  const last = segments[segments.length - 1]
  if (last?.type === type) {
    last.text += text
    return
  }
  segments.push({ type, text })
}

function computeSimpleInsertDeleteDiff(
  originalText: string,
  newText: string
): DiffSegment[] | null {
  if (originalText === newText) {
    return originalText.length > 0 ? [{ type: 'equal', text: originalText }] : []
  }

  if (originalText.length === 0) {
    return newText.length > 0 ? [{ type: 'insert', text: newText }] : []
  }

  if (newText.length === 0) {
    return originalText.length > 0 ? [{ type: 'delete', text: originalText }] : []
  }

  let prefixLength = 0
  const maxPrefixLength = Math.min(originalText.length, newText.length)
  while (
    prefixLength < maxPrefixLength &&
    originalText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  const maxSuffixLength = maxPrefixLength - prefixLength
  while (
    suffixLength < maxSuffixLength &&
    originalText[originalText.length - 1 - suffixLength] ===
      newText[newText.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const originalMiddle = originalText.slice(prefixLength, originalText.length - suffixLength)
  const newMiddle = newText.slice(prefixLength, newText.length - suffixLength)

  // 中文说明：这里只处理纯插入/纯删除。替换类编辑仍交给 diff-match-patch，
  // 保留它在复杂改写场景下更接近人类阅读的分片能力。
  if (originalMiddle.length > 0 && newMiddle.length > 0) {
    return null
  }

  const segments: DiffSegment[] = []
  pushDiffSegment(segments, 'equal', originalText.slice(0, prefixLength))
  pushDiffSegment(segments, originalMiddle.length > 0 ? 'delete' : 'insert', originalMiddle || newMiddle)
  pushDiffSegment(segments, 'equal', originalText.slice(originalText.length - suffixLength))
  return segments
}

/**
 * 计算两段文本的差异
 * @param originalText - 原始文本
 * @param newText - 新文本
 * @returns Diff 片段数组
 */
export function computeTextDiff(originalText: string, newText: string): DiffSegment[] {
  const fastPathSegments = computeSimpleInsertDeleteDiff(originalText, newText)
  if (fastPathSegments) {
    if (shouldLogRevisionDiffDebug()) {
      logRevisionDebug('[diffUtils] 命中简单插入/删除 fast path:', JSON.stringify(fastPathSegments))
    }
    return fastPathSegments
  }

  const dmp = new DiffMatchPatch()

  // 计算差异
  const diffs = dmp.diff_main(originalText, newText)

  if (shouldLogRevisionDiffDebug()) {
    logRevisionDebug('[diffUtils] 原始 diffs (before cleanup):', JSON.stringify(diffs))
  }

  // 清理差异，使其更易读（更接近人类理解的片段）
  // 使用 cleanupEfficiency 替代 cleanupSemantic，以避免在整段重写时出现"全删全插"的极端情况，
  // 同时又能提供比原始 diff 更好的可读性（减少过度碎片化）。
  dmp.diff_cleanupEfficiency(diffs)

  if (shouldLogRevisionDiffDebug()) {
    logRevisionDebug('[diffUtils] 清理后 diffs (after cleanup):', JSON.stringify(diffs))
  }

  // 转换为我们的格式
  return diffs.map(([operation, text]: [number, string]) => {
    let type: DiffType
    switch (operation) {
      case -1:
        type = 'delete'
        break
      case 1:
        type = 'insert'
        break
      default:
        type = 'equal'
    }
    return { type, text }
  })
}

/**
 * 计算带位置信息的差异
 * @param originalText - 原始文本
 * @param newText - 新文本
 * @param basePos - 基础位置（在文档中的起始位置）
 * @returns 带位置信息的 Diff 结果数组
 */
export function computeTextDiffWithPositions(
  originalText: string,
  newText: string,
  basePos: number = 0
): DiffResult[] {
  const segments = computeTextDiff(originalText, newText)
  const results: DiffResult[] = []

  let currentPos = basePos

  for (const segment of segments) {
    if (segment.type === 'equal') {
      // 相等的部分，移动位置
      currentPos += segment.text.length
    } else if (segment.type === 'delete') {
      // 删除的部分，记录原位置
      results.push({
        type: 'delete',
        text: segment.text,
        startPos: currentPos,
        endPos: currentPos + segment.text.length,
      })
      currentPos += segment.text.length
    } else {
      // 插入的部分，记录插入位置
      results.push({
        type: 'insert',
        text: segment.text,
        startPos: currentPos,
        endPos: currentPos, // 插入点的结束位置等于开始位置
      })
      // 注意：插入不移动原文档位置
    }
  }

  return results
}

/**
 * 计算 Diff 统计信息
 * @param segments - Diff 片段数组
 * @returns Diff 统计
 */
export function computeDiffStats(segments: DiffSegment[]): DiffStats {
  let insertCount = 0
  let deleteCount = 0
  let insertChars = 0
  let deleteChars = 0

  for (const segment of segments) {
    if (segment.type === 'insert') {
      insertCount++
      insertChars += segment.text.length
    } else if (segment.type === 'delete') {
      deleteCount++
      deleteChars += segment.text.length
    }
  }

  return {
    insertCount,
    deleteCount,
    insertChars,
    deleteChars,
  }
}

// ==================== 结构检测 ====================

/** 节点类型信息 */
interface NodeTypeInfo {
  type: string
  childTypes: string[]
}

/**
 * 检测两个 JSON 结构是否有重大变化
 * 用于判断是否需要降级到分栏视图
 *
 * @param originalJson - 原始 JSON
 * @param newJson - 新 JSON
 * @returns 是否有结构性变化
 */
export function detectStructuralChange(
  originalJson: Record<string, unknown>,
  newJson: Record<string, unknown>
): boolean {
  // 1. 比较根节点类型
  if (originalJson.type !== newJson.type) {
    return true
  }

  // 2. 获取子节点类型
  const originalChildren = getChildTypes(originalJson)
  const newChildren = getChildTypes(newJson)

  // 3. 类型变化检测
  if (!arraysHaveSameTypes(originalChildren, newChildren)) {
    return true
  }

  // 4. 子节点数量变化超过阈值
  if (Math.abs(originalChildren.length - newChildren.length) > 3) {
    return true
  }

  return false
}

/**
 * 获取节点的子节点类型列表
 */
function getChildTypes(node: Record<string, unknown>): string[] {
  const content = node.content as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(content)) {
    return []
  }

  return content.map((child) => (child.type as string) || 'unknown')
}

/**
 * 检查两个数组是否包含相同的类型（忽略顺序）
 */
function arraysHaveSameTypes(arr1: string[], arr2: string[]): boolean {
  const set1 = new Set(arr1)
  const set2 = new Set(arr2)

  if (set1.size !== set2.size) {
    return false
  }

  for (const item of set1) {
    if (!set2.has(item)) {
      return false
    }
  }

  return true
}

// ==================== 导出 ====================

export default {
  computeTextDiff,
  computeTextDiffWithPositions,
  computeDiffStats,
  detectStructuralChange,
}
