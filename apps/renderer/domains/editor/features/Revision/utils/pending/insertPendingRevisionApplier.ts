/**
 * 单条 Pending Revision - insert 操作应用器
 *
 * 职责：
 * - 根据 anchorBlockId 找到锚点 rootBlock
 * - 在锚点之后创建/复用目标 rootBlock（复用 InsertCommands.createRootBlock）
 * - 探测 newMarkdown 对应的块类型，并通过 ConversionCommands 修正类型
 * - 针对表格插入（pipe table）走专门路径；非表格走 RichDiff 流程
 * - 支持 citation hydration：如果 metadata 包含 citation_hydration，先水合 Markdown 再解析
 */

import type { Editor } from '@tiptap/core'
import type { Transaction } from 'prosemirror-state'
import type { ParsedPendingRevision, ApplyDetail } from './pendingRevisionTypes'
import {
  findRootBlockPosById,
  findRootBlockPosByIdInDoc,
  convertBlockByRootPos,
  resolvePendingMarkdownForSingleBlock,
} from './pendingRevisionHelpers'
import { linearizeRootBlock } from '../linearizeBlock'
import { useRevisionStore } from '../../store/useRevisionStore'
import { processCitationHydration } from './citationHydrationHelper'
import { hasRevisionMarksInBlock, scanBlockForRevisions } from '../../store/revisionMarkScan'
import {
  executePendingPlanToDocument,
  executePendingPlanToTr,
  type PendingExecutionPlan,
} from './pendingExecutionPlan'
import { buildInsertExecutionPlan } from './pendingPlanBuilder'
import { computeRichDiff } from '../richDiff'
import { infoRevisionDebug, logRevisionDebug } from '../revisionDebugLogging'
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta'

export async function applyInsertPendingRevision(
  editor: Editor,
  parsed: ParsedPendingRevision
): Promise<ApplyDetail> {
  const { blockId, newMarkdown, metadata } = parsed

  if (!blockId) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: 'insert 操作缺少 blockId',
    }
  }

  // 1. 验证 anchorBlockId 存在
  const anchorBlockId = metadata?.anchorBlockId as string | undefined
  if (!anchorBlockId) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: 'insert 操作缺少 anchorBlockId',
    }
  }

  // 1.5 处理 citation hydration（如果存在）
  const citationHydration = metadata?.citation_hydration as Record<string, unknown> | undefined
  const hydrationPrepared = await processCitationHydration(
    newMarkdown || '',
    citationHydration,
    { operation: 'applyInsertPendingRevision', blockId }
  )
  const processedMarkdown = hydrationPrepared.markdown
  infoRevisionDebug(
    `[applyInsertPendingRevision] hydration 准备完成: hasMeta=${!!citationHydration}, hasHydration=${!!hydrationPrepared.hydration}, blockId=${blockId}`
  )

  // 2. 预先探测块类型与"清洗后"的 Markdown 内容（使用水合后的 markdown）
  const resolution = await resolvePendingMarkdownForSingleBlock(editor, processedMarkdown, {
    operation: 'applyInsertPendingRevision',
    blockId,
    hydration: hydrationPrepared.hydration,
  })
  const { source: resolutionSource } = resolution

  logRevisionDebug(
    `[applyInsertPendingRevision] insert: resolutionKind=${resolution.kind}, source=${resolutionSource}, blockId=${blockId}`
  )

  // 3. 根据 anchorBlockId 找到锚点块位置
  if (findRootBlockPosById(editor, anchorBlockId) === null) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: `未找到 anchorBlockId=${anchorBlockId} 对应的 rootBlock，可能已被删除`,
    }
  }

  // 4. 检查目标块是否已存在（防止重复创建）
  const existingBlockPos = findRootBlockPosById(editor, blockId)
  if (existingBlockPos === null) {
    console.warn(
      `[applyInsertPendingRevision] insert: 未找到 blockId=${blockId} 对应的 rootBlock，无法应用 insert pending`
    )

    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: `未找到 blockId=${blockId} 对应的 rootBlock，无法应用 insert pending`,
    }
  } else {
    logRevisionDebug(`[applyInsertPendingRevision] 目标块 blockId=${blockId} 已存在，直接应用修订`)

    // 检查并修正块类型（复用 convertBlockByRootPos）
    const existingRootBlock = editor.state.doc.nodeAt(existingBlockPos)
    if (existingRootBlock) {
      const currentContentNode = existingRootBlock.child(0)
      const currentType = currentContentNode.type.name

      if (
        resolution.kind === 'content-block' &&
        currentType !== resolution.contentType &&
        editor.state.schema.nodes[resolution.contentType]
      ) {
        logRevisionDebug(
          `[applyInsertPendingRevision] insert 目标块类型修正: ${currentType} -> ${resolution.contentType}`
        )
        convertBlockByRootPos(
          editor,
          existingBlockPos,
          resolution.contentType,
          resolution.blockAttrs
        )
      } else if (resolution.kind === 'content-block' && currentType === resolution.contentType) {
        const mergedAttrs = {
          ...currentContentNode.attrs,
          ...resolution.blockAttrs,
        }
        const attrsChanged =
          JSON.stringify(currentContentNode.attrs) !== JSON.stringify(mergedAttrs)

        if (attrsChanged) {
          convertBlockByRootPos(
            editor,
            existingBlockPos,
            resolution.contentType,
            resolution.blockAttrs
          )
        }
      }
    }

  }

  // 5. 现在目标块应该存在了，找到它的位置
  const targetBlockPos = findRootBlockPosById(editor, blockId)
  if (targetBlockPos === null) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: '创建新块后仍然无法找到目标块',
    }
  }

  // 7. 生成 revisionId
  const revisionId = `ai-${parsed.id}`

  const currentContent = linearizeRootBlock(editor, targetBlockPos)
  const plan: PendingExecutionPlan | null = currentContent
    ? buildInsertExecutionPlan({
        resolution,
        currentSpans: currentContent.spans,
        currentPlainText: currentContent.plainText,
        hydration: hydrationPrepared.hydration,
      })
    : null

  if (!plan) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: `无法提取 blockId=${blockId} 的块内容`,
    }
  }

  const executeResult = executePendingPlanToDocument({
    editor,
    blockPos: targetBlockPos,
    revisionId,
    plan,
  })
  if (!executeResult.success || !executeResult.diffStats) {
    return {
      id: parsed.id,
      success: false,
      operation: 'insert',
      blockId,
      reason: executeResult.reason || '应用执行计划失败',
    }
  }

  const finalDiffStats = executeResult.diffStats

  // 9. 在 RevisionStore 中注册修订状态
  try {
    const revisionStore = useRevisionStore(editor)
    revisionStore.startRevision({
      blockId,
      revisionId,
      operation: 'insert',
      diffStats: finalDiffStats,
      // 中文说明：优先使用后端 pending_revisions 的 createdAt，避免重复注入导致时间统一刷新
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    })
  } catch (e) {
    console.warn(`[applyInsertPendingRevision] 注册 RevisionStore 失败:`, e)
  }

  return {
    id: parsed.id,
    success: true,
    operation: 'insert',
    blockId,
  }
}

// ==================== 预处理结果类型 ====================

interface PreparedInsert {
  parsed: ParsedPendingRevision
  blockId: string
  revisionId: string
  plan: PendingExecutionPlan
  /** 是否已在文档中存在同 revisionId 的修订标记（用于幂等短路） */
  alreadyApplied?: boolean
  /** 已存在修订的统计信息，供 RevisionStore 恢复使用 */
  existingDiffStats?: { insertCount: number; deleteCount: number }
  /** 本轮执行后产出的统计信息 */
  appliedDiffStats?: { insertCount: number; deleteCount: number }
  /** 预处理阶段错误 */
  error?: string
}

// ==================== Mega-Transaction 批量 Insert ====================

/**
 * 批量应用 insert pending revisions（mega-transaction 模式）
 *
 * 核心优化：将 N 个 insert 的 diff 应用合并到 1 个 ProseMirror transaction 中，
 * 避免 N 次 state.apply 的插件链开销（从 ~3ms×N 降到 ~3ms×1）。
 *
 * 流程分为三阶段：
 * 1. 预处理：hydration、类型检测、markdown 解析（不 dispatch）
 * 2. 类型转换：少量 block 可能需要 convertBlockByRootPos（单独 dispatch，很少触发）
 * 3. 批量应用：一个 mega-tr 包含所有 insert 的 diff 操作，最后 dispatch 一次
 */
export async function batchApplyInsertPendingRevisions(
  editor: Editor,
  inserts: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  const results: ApplyDetail[] = []
  if (inserts.length === 0) return results

  // ====== 阶段 1：预处理所有 insert（不 dispatch） ======
  const prepared: PreparedInsert[] = []

  for (const parsed of inserts) {
    // 中文说明：主动让出主线程，避免连续处理多个 insert 阻塞渲染
    await new Promise(resolve => setTimeout(resolve, 0))

    const { blockId, newMarkdown, metadata } = parsed

    if (!blockId) {
      results.push({ id: parsed.id, success: false, operation: 'insert', blockId, reason: 'insert 操作缺少 blockId' })
      continue
    }

    const anchorBlockId = metadata?.anchorBlockId as string | undefined
    if (!anchorBlockId) {
      results.push({ id: parsed.id, success: false, operation: 'insert', blockId, reason: 'insert 操作缺少 anchorBlockId' })
      continue
    }

    // 1a. citation hydration
    const citationHydration = metadata?.citation_hydration as Record<string, unknown> | undefined
    const hydrationPrepared = await processCitationHydration(
      newMarkdown || '',
      citationHydration,
      { operation: 'batchApplyInsert', blockId }
    )
    const processedMarkdown = hydrationPrepared.markdown

    // 1b. 块类型探测
    const resolution = await resolvePendingMarkdownForSingleBlock(editor, processedMarkdown, {
      operation: 'batchApplyInsert',
      blockId,
      hydration: hydrationPrepared.hydration,
    })
    const { source: resolutionSource } = resolution
    logRevisionDebug(
      `[batchApplyInsert] resolutionKind=${resolution.kind}, source=${resolutionSource}, blockId=${blockId}`
    )

    // 1d. 检查目标块是否存在
    const existingBlockPos = findRootBlockPosById(editor, blockId)
    if (existingBlockPos === null) {
      results.push({ id: parsed.id, success: false, operation: 'insert', blockId, reason: `未找到 blockId=${blockId} 对应的 rootBlock` })
      continue
    }

    // 1e. 类型转换（如有需要，这里会 dispatch，但触发率很低）
    const existingRootBlock = editor.state.doc.nodeAt(existingBlockPos)
    if (existingRootBlock) {
      const currentContentNode = existingRootBlock.child(0)
      const currentType = currentContentNode.type.name

      if (
        resolution.kind === 'content-block' &&
        currentType !== resolution.contentType &&
        editor.state.schema.nodes[resolution.contentType]
      ) {
        convertBlockByRootPos(
          editor,
          existingBlockPos,
          resolution.contentType,
          resolution.blockAttrs
        )
      } else if (resolution.kind === 'content-block' && currentType === resolution.contentType) {
        const mergedAttrs = { ...currentContentNode.attrs, ...resolution.blockAttrs }
        if (JSON.stringify(currentContentNode.attrs) !== JSON.stringify(mergedAttrs)) {
          convertBlockByRootPos(
            editor,
            existingBlockPos,
            resolution.contentType,
            resolution.blockAttrs
          )
        }
      }
    }

    if (resolution.kind === 'table-block') {
      prepared.push({
        parsed,
        blockId,
        revisionId: `ai-${parsed.id}`,
        plan: {
          kind: 'table-insert',
          tableRows: resolution.tableRowsResult.rows,
        },
      })
      continue
    }

    // 1g. 非表格：预计算 diff（纯计算，不 dispatch）
    const targetBlockPos = findRootBlockPosById(editor, blockId)
    if (targetBlockPos === null) {
      results.push({ id: parsed.id, success: false, operation: 'insert', blockId, reason: '类型转换后无法找到目标块' })
      continue
    }

    const revisionId = `ai-${parsed.id}`
    if (hasRevisionMarksInBlock(editor, targetBlockPos, revisionId)) {
      const existingScan = scanBlockForRevisions(editor, targetBlockPos)
      prepared.push({
        parsed,
        blockId,
        revisionId,
        plan: {
          kind: 'content-diff',
          richDiff: computeRichDiff([], []),
          insertNewlineMode: 'hardBreak',
        },
        alreadyApplied: true,
        existingDiffStats: existingScan?.revisionId === revisionId
          ? existingScan.diffStats
          : { insertCount: 1, deleteCount: 0 },
      })
      continue
    }

    const currentContent = linearizeRootBlock(editor, targetBlockPos)
    prepared.push({
      parsed,
      blockId,
      revisionId,
      plan: buildInsertExecutionPlan({
        resolution,
        currentSpans: currentContent?.spans ?? [],
        currentPlainText: currentContent?.plainText ?? '',
        hydration: hydrationPrepared.hydration,
      }),
    })
  }

  // ====== 阶段 2：mega-transaction 批量应用 ======
  const megaTr: Transaction = editor.state.tr

  for (const item of prepared) {
    if (item.alreadyApplied) {
      results.push({ id: item.parsed.id, success: true, operation: 'insert', blockId: item.blockId, reason: '已存在相同 revisionMark，跳过重复应用' })
      continue
    }

    // 在 mega-tr.doc 中查找当前 block 位置（位置可能因前面的操作而变化）
    const currentPos = findRootBlockPosByIdInDoc(megaTr.doc, item.blockId)
    if (currentPos === null) {
      results.push({ id: item.parsed.id, success: false, operation: 'insert', blockId: item.blockId, reason: 'mega-tr 中无法定位目标块' })
      continue
    }

    const executeResult = executePendingPlanToTr({
      tr: megaTr,
      blockPos: currentPos,
      revisionId: item.revisionId,
      plan: item.plan,
    })

    if (!executeResult.success) {
      results.push({ id: item.parsed.id, success: false, operation: 'insert', blockId: item.blockId, reason: executeResult.reason || item.error || '应用执行计划到 mega-tr 失败' })
      continue
    }

    item.appliedDiffStats = executeResult.diffStats
    results.push({ id: item.parsed.id, success: true, operation: 'insert', blockId: item.blockId, reason: executeResult.reason })
  }

  // 设置 meta 并一次性 dispatch
  markPendingRevisionProjectionTransaction(megaTr)
  if (megaTr.docChanged) {
    editor.view.dispatch(megaTr)
  }

  // ====== 阶段 3：注册 RevisionStore ======
  for (const item of prepared) {
    const matchingResult = results.find(r => r.id === item.parsed.id)
    if (!matchingResult?.success) continue
    const diffStats = item.existingDiffStats ?? item.appliedDiffStats
    if (!diffStats || (diffStats.insertCount === 0 && diffStats.deleteCount === 0)) continue

    try {
      const revisionStore = useRevisionStore(editor)
      revisionStore.startRevision({
        blockId: item.blockId,
        revisionId: item.revisionId,
        operation: 'insert',
        diffStats,
        createdAt: typeof item.parsed.createdAt === 'number' ? item.parsed.createdAt : undefined,
      })
    } catch (e) {
      console.warn(`[batchApplyInsert] 注册 RevisionStore 失败:`, e)
    }
  }

  return results
}
