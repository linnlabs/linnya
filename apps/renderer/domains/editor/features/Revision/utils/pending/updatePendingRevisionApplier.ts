/**
 * 单条 Pending Revision - update 操作应用器
 *
 * 职责：
 * - 根据 blockId 找到目标 rootBlock
 * - 探测 newMarkdown 对应的块类型（heading / list / quote / base）
 * - 利用 ConversionCommands（通过 convertBlockByRootPos）修正块类型与属性
 * - 对 cleanMarkdown 与当前内容做 RichDiff，生成修订标记
 * - 针对表格（pipe table）走专门的整块替换 + 历史块保留逻辑
 * - 支持 citation hydration：如果 metadata 包含 citation_hydration，先水合 Markdown 再解析
 */

import type { Editor } from '@tiptap/core'
import type { ParsedPendingRevision, ApplyDetail } from './pendingRevisionTypes'
import {
  findRootBlockPosById,
  convertBlockByRootPos,
  resolvePendingMarkdownForSingleBlock,
} from './pendingRevisionHelpers'
import { linearizeRootBlock } from '../linearizeBlock'
import { useRevisionStore } from '../../store/useRevisionStore'
import { processCitationHydration } from './citationHydrationHelper'
import {
  executePendingPlanToDocument,
  type PendingExecutionPlan,
} from './pendingExecutionPlan'
import { buildUpdateExecutionPlan } from './pendingPlanBuilder'
import { infoRevisionDebug, logRevisionDebug } from '../revisionDebugLogging'

/**
 * 将单个 Pending Revision 应用到编辑器（update 操作）
 */
export async function applyUpdatePendingRevision(
  editor: Editor,
  parsed: ParsedPendingRevision
): Promise<ApplyDetail> {
  const { blockId, newMarkdown } = parsed

  if (!blockId) {
    return {
      id: parsed.id,
      success: false,
      operation: 'update',
      blockId,
      reason: 'update 操作缺少 blockId',
    }
  }

  // 0. 处理 citation hydration（如果存在）
  const citationHydration = parsed.metadata?.citation_hydration as Record<string, unknown> | undefined
  const hydrationPrepared = await processCitationHydration(
    newMarkdown || '',
    citationHydration,
    { operation: 'applyUpdatePendingRevision', blockId }
  )
  const processedMarkdown = hydrationPrepared.markdown
  infoRevisionDebug(
    `[applyUpdatePendingRevision] hydration 准备完成: hasMeta=${!!citationHydration}, hasHydration=${!!hydrationPrepared.hydration}, blockId=${blockId}`
  )

  // 1. 根据 blockId 找到块位置
  const blockPos = findRootBlockPosById(editor, blockId)
  if (blockPos === null) {
    // 这里命中的通常是"幽灵 Pending Revision"
    try {
      const revisionStore = useRevisionStore(editor)
      await revisionStore.clearBackendPendingForBlock(blockId)
      console.warn(
        `[applyUpdatePendingRevision] 检测到指向已删除块的 Pending Revision，已在后端清理: blockId=${blockId}`
      )
    } catch (e) {
      console.warn(
        '[applyUpdatePendingRevision] 清理后端幽灵 Pending Revision 失败:',
        e
      )
    }

    return {
      id: parsed.id,
      success: false,
      operation: 'update',
      blockId,
      reason: `未找到 blockId=${blockId} 对应的 rootBlock，可能已被删除；已尝试自动清理对应 Pending Revision 记录`,
    }
  }

  // 2. 获取当前块内容
  const currentContent = linearizeRootBlock(editor, blockPos)
  if (!currentContent) {
    return {
      id: parsed.id,
      success: false,
      operation: 'update',
      blockId,
      reason: `无法提取 blockId=${blockId} 的块内容`,
    }
  }

  // 3. 预处理 Markdown：探测块类型与清洗内容（使用水合后的 markdown）
  const resolution = await resolvePendingMarkdownForSingleBlock(editor, processedMarkdown, {
    operation: 'applyUpdatePendingRevision',
    blockId,
    hydration: hydrationPrepared.hydration,
  })
  logRevisionDebug(
    `[applyUpdatePendingRevision] resolutionKind=${resolution.kind}, source=${resolution.source}, blockId=${blockId}`
  )

  // 3.1 检查并修正块类型（复用 ConversionCommands）
  const rootBlockNode = editor.state.doc.nodeAt(blockPos)
  if (rootBlockNode) {
    const currentContentNode = rootBlockNode.child(0)
    const currentType = currentContentNode.type.name

    // 类型不匹配 → 通过 convertBlockByRootPos 统一走 ConversionCommands
    if (
      resolution.kind === 'content-block' &&
      currentType !== resolution.contentType &&
      editor.state.schema.nodes[resolution.contentType]
    ) {
      logRevisionDebug(
        `[applyUpdatePendingRevision] 类型转换: ${currentType} -> ${resolution.contentType}, blockId=${blockId}`
      )

      const success = convertBlockByRootPos(
        editor,
        blockPos,
        resolution.contentType,
        resolution.blockAttrs
      )

      if (!success) {
        console.warn('[applyUpdatePendingRevision] 类型转换失败，继续使用原类型')
      }
    } else if (resolution.kind === 'content-block' && currentType === resolution.contentType) {
      // 类型相同但属性可能不同，继续通过 convertBlockByRootPos 让 ConversionCommands 统一处理 attrs
      const mergedAttrs = {
        ...currentContentNode.attrs,
        ...resolution.blockAttrs,
      }
      const attrsChanged =
        JSON.stringify(currentContentNode.attrs) !== JSON.stringify(mergedAttrs)

      if (attrsChanged) {
        logRevisionDebug(
          `[applyUpdatePendingRevision] 属性更新: ${JSON.stringify(
            currentContentNode.attrs
          )} -> ${JSON.stringify(mergedAttrs)}`
        )
        convertBlockByRootPos(editor, blockPos, resolution.contentType, resolution.blockAttrs)
      }
    }
  }

  const plan: PendingExecutionPlan = await buildUpdateExecutionPlan({
    resolution,
    currentSpans: currentContent.spans,
    processedMarkdown,
    blockId,
    hydration: hydrationPrepared.hydration,
    operation: 'applyUpdatePendingRevision',
  })

  const revisionId = `ai-${parsed.id}`
  const executeResult = executePendingPlanToDocument({
    editor,
    blockPos,
    revisionId,
    plan,
    historyBlockId:
      plan.kind === 'table-update-with-history' ? `history-${blockId}-${Date.now()}` : undefined,
  })
  if (!executeResult.success) {
    return {
      id: parsed.id,
      success: false,
      operation: 'update',
      blockId,
      reason: executeResult.reason || '应用执行计划失败',
    }
  }
  if (!executeResult.diffStats || (executeResult.diffStats.insertCount === 0 && executeResult.diffStats.deleteCount === 0)) {
    return {
      id: parsed.id,
      success: true,
      operation: 'update',
      blockId,
      reason: executeResult.reason || '内容无差异，无需应用修订',
    }
  }

  // 8. 在 RevisionStore 中注册修订状态
  try {
    const revisionStore = useRevisionStore(editor)
    revisionStore.startRevision({
      blockId,
      revisionId,
      operation: 'update',
      diffStats: executeResult.diffStats,
      // 中文说明：优先使用后端 pending_revisions 的 createdAt，避免重复注入导致时间统一刷新
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    })
  } catch (e) {
    console.warn(`[applyUpdatePendingRevision] 注册 RevisionStore 失败:`, e)
  }

  return {
    id: parsed.id,
    success: true,
    operation: 'update',
    blockId,
    reason: executeResult.reason,
  }
}

export {
  batchApplyNonInsertPendingRevisions,
  batchApplyUpdatePendingRevisions,
} from './nonInsertPendingRevisionBatchApplier'
