/**
 * Pending Revisions 批量应用入口
 * 
 * 职责：
 * - 接收 pending revisions 数组
 * - 按操作类型分组（insert 需要特殊处理）
 * - 编排应用顺序（非 insert 先执行，insert 按 anchor 分组）
 * - 聚合统计结果
 * 
 * 细节实现：
 * - 类型定义 → pendingRevisionTypes.ts
 * - 表格解析 → pipeTableParser.ts
 * - 单条应用 → update/insert/deletePendingRevisionApplier.ts
 */

import type { Editor } from '@tiptap/core'
import type {
  PendingRevisionDTO,
  ParsedPendingRevision,
  ApplyPendingRevisionsResult,
} from './pendingRevisionTypes'
import { batchApplyNonInsertPendingRevisions } from './updatePendingRevisionApplier'
import { batchApplyInsertPendingRevisions } from './insertPendingRevisionApplier'
import { planPendingExecutionBatches } from './pendingBatchPlanner'
import { infoRevisionDebug, shouldLogRevisionDebug } from '../revisionDebugLogging'

export interface ApplyPendingRevisionsPerfHooks {
  onStage?: (stage: 'parse' | 'plan' | 'apply', durationMs: number) => void
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function measureStage<T>(
  hooks: ApplyPendingRevisionsPerfHooks | undefined,
  stage: 'parse' | 'plan' | 'apply',
  fn: () => T
): T {
  const started = nowMs()
  try {
    return fn()
  } finally {
    hooks?.onStage?.(stage, nowMs() - started)
  }
}

async function measureStageAsync<T>(
  hooks: ApplyPendingRevisionsPerfHooks | undefined,
  stage: 'parse' | 'plan' | 'apply',
  fn: () => Promise<T>
): Promise<T> {
  const started = nowMs()
  try {
    return await fn()
  } finally {
    hooks?.onStage?.(stage, nowMs() - started)
  }
}

/**
 * 解析 PendingRevisionDTO，从 metadata 中提取 operation 和 anchorBlockId
 * 
 * @param dto - 原始 DTO
 * @returns 解析后的 ParsedPendingRevision
 */
function parsePendingRevision(dto: PendingRevisionDTO): ParsedPendingRevision {
  let metaFromJson: Record<string, unknown> | undefined
  if (dto.metaJson) {
    try {
      const parsed = JSON.parse(dto.metaJson) as unknown
      if (parsed && typeof parsed === 'object') {
        metaFromJson = parsed as Record<string, unknown>
      }
    } catch (e) {
      console.warn('[applyPendingRevisions] 解析 metaJson 失败:', e)
    }
  }
  const metadata =
    metaFromJson && dto.metadata
      ? { ...metaFromJson, ...dto.metadata }
      : metaFromJson ?? dto.metadata

  return {
    ...dto,
    metadata,
    shouldRetry: false, // 当前版本不支持重试
  }
}

/**
 * 将 Pending Revisions 批量应用到编辑器（异步）
 *
 * 此函数应在文档加载完成后、用户开始编辑前调用。
 * 它会遍历所有 pending revisions，将它们转换为可视化的 Revision 视图。
 *
 * @param editor - Tiptap 编辑器实例
 * @param pendingRevisions - 从后端获取的 pending revisions 数组
 * @returns 应用结果统计（Promise）
 *
 * @example
 * ```ts
 * // 在文档加载后调用
 * const result = await applyPendingRevisionsToEditor(editor, pendingRevisions)
 * console.log(`成功: ${result.successIds.length}, 失败: ${result.failedIds.length}`)
 * ```
 */
export async function applyPendingRevisionsToEditor(
  editor: Editor,
  pendingRevisions: PendingRevisionDTO[],
  perfHooks?: ApplyPendingRevisionsPerfHooks
): Promise<ApplyPendingRevisionsResult> {
  const result: ApplyPendingRevisionsResult = {
    successIds: [],
    failedIds: [],
    details: [],
  }

  if (pendingRevisions.length === 0) {
    return result
  }

  if (pendingRevisions.length >= 20 && shouldLogRevisionDebug()) {
    infoRevisionDebug(`[applyPendingRevisions] 开始应用 ${pendingRevisions.length} 个 pending revisions`)
  }

  // 1. 解析所有 pending revisions
  const parsedRevisions = measureStage(perfHooks, 'parse', () => pendingRevisions.map(parsePendingRevision))

  // 2. 统一交给 batch planner，insert anchor 链与 non-insert 共批策略都在同一个入口收敛
  const batches = measureStage(perfHooks, 'plan', () => planPendingExecutionBatches(parsedRevisions))

  await measureStageAsync(perfHooks, 'apply', async () => {
    for (const batch of batches) {
      const details =
        batch.kind === 'non-insert'
          ? await batchApplyNonInsertPendingRevisions(editor, batch.revisions)
          : await batchApplyInsertPendingRevisions(editor, batch.revisions)

      for (const detail of details) {
        result.details.push(detail)
        if (detail.success) {
          result.successIds.push(detail.id)
        } else {
          result.failedIds.push(detail.id)
        }
      }
    }
  })

  if (result.failedIds.length > 0 || (pendingRevisions.length >= 20 && shouldLogRevisionDebug())) {
    console.info(
      `[applyPendingRevisions] 完成: 总计=${pendingRevisions.length}, 成功=${result.successIds.length}, 失败=${result.failedIds.length}`
    )
  }

  return result
}

export default applyPendingRevisionsToEditor
