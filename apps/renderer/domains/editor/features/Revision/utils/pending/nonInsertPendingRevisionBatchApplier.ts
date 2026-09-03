/**
 * nonInsertPendingRevisionBatchApplier
 *
 * 中文说明：
 * - 专门负责 update/delete pending revision 的窗口化批处理；
 * - 准备阶段可并行：citation hydration、Markdown runtime 解析、RichDiff plan 构建；
 * - 应用阶段必须串行：所有 replace/convert 都写入同一个 megaTr，且每步后重新按 blockId 定位。
 */

import type { Editor } from '@tiptap/core'
import type { Transaction } from 'prosemirror-state'
import type {
  ApplyDetail,
  ParsedPendingRevision,
  PendingRevisionOperation,
} from './pendingRevisionTypes'
import {
  convertBlockByRootPosInTr,
  findRootBlockPosByIdInDoc,
  resolvePendingMarkdownForSingleBlock,
  type PendingMarkdownResolutionResult,
} from './pendingRevisionHelpers'
import { canResolvePendingMarkdownAsPlainTextFastPath } from './pendingPlainTextFastPath'
import { linearizeNode } from '../linearizeBlock'
import { processCitationHydration } from './citationHydrationHelper'
import { executePendingPlanToTr } from './pendingExecutionPlan'
import {
  buildDeleteExecutionPlan,
  buildUpdateExecutionPlan,
} from './pendingPlanBuilder'
import {
  buildNonInsertBatchPerfReport,
  createAppliedRevisionPerf,
  createPreparedRevisionPerf,
  formatErrorMessage,
  markPreparedError,
  measureAppliedStage,
  measurePreparedStage,
  measurePreparedStageSync,
  nowMs,
  publishNonInsertBatchPerfReport,
  roundMs,
  type AppliedRevisionPerf,
  type PreparedRevisionPerf,
} from './nonInsertPendingRevisionBatchPerf'
import {
  createExecutionHistoryBlockId,
  pushFailedExecutionResult,
  pushMissingBlockWarning,
  pushSuccessfulExecutionResult,
  registerPreparedRevisions,
  type RegisterablePreparedRevision,
} from './nonInsertPendingRevisionBatchHelpers'
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta'

interface PreparedNonInsertRevision extends RegisterablePreparedRevision {
  initialBlockPos: number
  resolution?: PendingMarkdownResolutionResult
  perf: PreparedRevisionPerf
}

interface PreparedNonInsertReady {
  kind: 'ready'
  item: PreparedNonInsertRevision
  perf: PreparedRevisionPerf
}

interface PreparedNonInsertSkip {
  kind: 'skip'
  detail: ApplyDetail
  missingBlockId?: string
  perf: PreparedRevisionPerf
}

type PreparedNonInsertResult = PreparedNonInsertReady | PreparedNonInsertSkip

const PLAIN_TEXT_PREPARE_WITHOUT_YIELD_MAX_LENGTH = 4096

function getParsedOperation(parsed: ParsedPendingRevision): PendingRevisionOperation {
  const metaOperation = parsed.metadata?.operation
  if (metaOperation === 'insert' || metaOperation === 'update' || metaOperation === 'delete') {
    return metaOperation
  }
  return parsed.operation
}

function getNonInsertOperation(
  parsed: ParsedPendingRevision
): Exclude<PendingRevisionOperation, 'insert'> {
  return getParsedOperation(parsed) === 'delete' ? 'delete' : 'update'
}

function hasRepeatedTargetBlock(revisions: ParsedPendingRevision[]): boolean {
  const seen = new Set<string>()
  for (const parsed of revisions) {
    if (!parsed.blockId) continue
    if (seen.has(parsed.blockId)) return true
    seen.add(parsed.blockId)
  }
  return false
}

function applyResolutionConversionToTr(
  tr: Transaction,
  blockPos: number,
  resolution: PendingMarkdownResolutionResult | undefined
): void {
  if (!resolution || resolution.kind !== 'content-block') return

  const rootBlockNode = tr.doc.nodeAt(blockPos)
  if (!rootBlockNode || rootBlockNode.childCount === 0) return

  const currentContentNode = rootBlockNode.child(0)
  const currentType = currentContentNode.type.name

  if (
    currentType !== resolution.contentType &&
    tr.doc.type.schema.nodes[resolution.contentType]
  ) {
    convertBlockByRootPosInTr(tr, blockPos, resolution.contentType, resolution.blockAttrs)
    return
  }

  if (currentType !== resolution.contentType) return

  const mergedAttrs = {
    ...currentContentNode.attrs,
    ...resolution.blockAttrs,
  }
  if (JSON.stringify(currentContentNode.attrs) !== JSON.stringify(mergedAttrs)) {
    convertBlockByRootPosInTr(tr, blockPos, resolution.contentType, resolution.blockAttrs)
  }
}

function isRootBlockAtPos(
  doc: Transaction['doc'],
  pos: number,
  blockId: string
): boolean {
  const node = doc.nodeAt(pos)
  return node?.type.name === 'rootBlock' && node.attrs.id === blockId
}

function findCurrentRootBlockPosInTr(
  tr: Transaction,
  initialBlockPos: number,
  blockId: string
): number | null {
  // 中文说明：parallel prepare 已在原始 doc 上定位过 blockPos。
  // apply 阶段的 megaTr 会随每个块的投影持续演进，直接对每个新 doc 重建
  // blockPosIndex 会把 10000 pending 的窗口投影卡在定位常数上。这里优先用
  // transaction mapping 把初始位置映射到当前 doc；只有映射校验失败才回退索引。
  const mappedPos = tr.mapping.map(initialBlockPos, 1)
  if (isRootBlockAtPos(tr.doc, mappedPos, blockId)) return mappedPos

  return findRootBlockPosByIdInDoc(tr.doc, blockId)
}

function createMissingBlockDetail(
  parsed: ParsedPendingRevision,
  operation: Exclude<PendingRevisionOperation, 'insert'>,
  blockId: string
): ApplyDetail {
  return {
    id: parsed.id,
    success: false,
    operation,
    blockId,
    reason: `未找到 blockId=${blockId} 对应的 rootBlock，可能已被删除`,
  }
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return (
    value != null
    && typeof value === 'object'
    && !Array.isArray(value)
  )
}

function readCitationHydrationMetadata(
  parsed: ParsedPendingRevision
): Record<string, unknown> | undefined {
  const citationHydration = parsed.metadata?.citation_hydration
  return isPlainObjectRecord(citationHydration) ? citationHydration : undefined
}

function hasCitationHydrationMetadata(parsed: ParsedPendingRevision): boolean {
  const citationHydration = readCitationHydrationMetadata(parsed)
  return citationHydration != null && Object.keys(citationHydration).length > 0
}

function shouldYieldBeforePrepare(parsed: ParsedPendingRevision): boolean {
  const operation = getNonInsertOperation(parsed)
  if (operation !== 'update') return true
  if (hasCitationHydrationMetadata(parsed)) return true

  const markdown = parsed.newMarkdown ?? ''
  if (markdown.length > PLAIN_TEXT_PREPARE_WITHOUT_YIELD_MAX_LENGTH) return true

  // 中文说明：普通单行文本已经由 plain-text fast path 保证不会进入 Markdown runtime。
  // 这类更新在滚动懒投影中非常高频，继续固定 setTimeout 会把 8 个块的批次
  // 主要耗时浪费在 timer 等待上；复杂 Markdown / 引用 / delete 仍然让帧，保护交互。
  return !canResolvePendingMarkdownAsPlainTextFastPath(markdown)
}

async function yieldBeforePrepareIfNeeded(
  parsed: ParsedPendingRevision,
  perf: PreparedRevisionPerf
): Promise<void> {
  if (!shouldYieldBeforePrepare(parsed)) return

  const startedAt = nowMs()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  perf.yieldMs = roundMs(perf.yieldMs + nowMs() - startedAt)
}

async function prepareNonInsertRevision(
  editor: Editor,
  parsed: ParsedPendingRevision
): Promise<PreparedNonInsertResult> {
  const prepareStartedAt = nowMs()
  const { blockId, newMarkdown } = parsed
  const operation = getNonInsertOperation(parsed)
  const perf = createPreparedRevisionPerf(parsed, operation)

  try {
    await yieldBeforePrepareIfNeeded(parsed, perf)

    if (!blockId) {
      perf.skipped = true
      return {
        kind: 'skip',
        perf,
        detail: {
          id: parsed.id,
          success: false,
          operation,
          blockId,
          reason: `${operation} 操作缺少 blockId`,
        },
      }
    }

    const blockPos = measurePreparedStageSync(perf, 'blockLookupMs', () =>
      findRootBlockPosByIdInDoc(editor.state.doc, blockId)
    )
    if (blockPos === null) {
      perf.skipped = true
      return {
        kind: 'skip',
        perf,
        missingBlockId: blockId,
        detail: createMissingBlockDetail(parsed, operation, blockId),
      }
    }

    const revisionId = `ai-${parsed.id}`

    if (operation === 'delete') {
      const currentRootBlockNode = editor.state.doc.nodeAt(blockPos)
      const currentContent = measurePreparedStageSync(perf, 'linearizeMs', () =>
        currentRootBlockNode ? linearizeNode(currentRootBlockNode) : null
      )
      if (!currentRootBlockNode || !currentContent) {
        perf.skipped = true
        return {
          kind: 'skip',
          perf,
          detail: {
            id: parsed.id,
            success: false,
            operation,
            blockId,
            reason: `无法提取 blockId=${blockId} 的块内容`,
          },
        }
      }

      const plan = measurePreparedStageSync(perf, 'planMs', () =>
        buildDeleteExecutionPlan(currentContent.spans)
      )
      perf.planKind = plan.kind

      const item: PreparedNonInsertRevision = {
        parsed,
        blockId,
        initialBlockPos: blockPos,
        revisionId,
        operation,
        plan,
        perf,
      }
      return {
        kind: 'ready',
        item,
        perf,
      }
    }

    const citationHydration = readCitationHydrationMetadata(parsed)
    const hydrationPrepared = await measurePreparedStage(perf, 'hydrationMs', () =>
      processCitationHydration(
        newMarkdown || '',
        citationHydration,
        { operation: 'batchApplyUpdatePendingRevisions.prepare', blockId }
      )
    )
    const processedMarkdown = hydrationPrepared.markdown

    const resolution = await measurePreparedStage(perf, 'resolveMs', () =>
      resolvePendingMarkdownForSingleBlock(editor, processedMarkdown, {
        operation: 'batchApplyUpdatePendingRevisions.prepare',
        blockId,
        hydration: hydrationPrepared.hydration,
      })
    )
    perf.resolutionKind = resolution.kind
    perf.resolutionSource = resolution.source

    // 中文说明：prepare 阶段不能改 megaTr，但 plan 必须基于“类型转换后的当前块”计算。
    // 因此这里用独立 transaction 模拟本块转换，得到与旧串行路径一致的 currentSpans。
    const previewTr = editor.state.tr
    measurePreparedStageSync(perf, 'previewConversionMs', () => {
      applyResolutionConversionToTr(previewTr, blockPos, resolution)
    })

    const previewBlockPos = measurePreparedStageSync(perf, 'blockLookupMs', () =>
      findRootBlockPosByIdInDoc(previewTr.doc, blockId)
    )
    if (previewBlockPos === null) {
      perf.skipped = true
      return {
        kind: 'skip',
        perf,
        detail: {
          id: parsed.id,
          success: false,
          operation,
          blockId,
          reason: '类型转换后无法找到目标块',
        },
      }
    }

    const currentRootBlockNode = previewTr.doc.nodeAt(previewBlockPos)
    const currentContent = measurePreparedStageSync(perf, 'linearizeMs', () =>
      currentRootBlockNode ? linearizeNode(currentRootBlockNode) : null
    )
    if (!currentRootBlockNode || !currentContent) {
      perf.skipped = true
      return {
        kind: 'skip',
        perf,
        detail: {
          id: parsed.id,
          success: false,
          operation,
          blockId,
          reason: `无法提取 blockId=${blockId} 的块内容`,
        },
      }
    }

    const plan = await measurePreparedStage(perf, 'planMs', () =>
      buildUpdateExecutionPlan({
        resolution,
        currentSpans: currentContent.spans,
        processedMarkdown,
        blockId,
        hydration: hydrationPrepared.hydration,
        operation: 'batchApplyUpdatePendingRevisions.prepare',
      })
    )
    perf.planKind = plan.kind

    const item: PreparedNonInsertRevision = {
      parsed,
      blockId,
      initialBlockPos: blockPos,
      revisionId,
      operation,
      resolution,
      plan,
      perf,
    }

    return {
      kind: 'ready',
      item,
      perf,
    }
  } catch (error) {
    markPreparedError(perf, perf.errorStage ?? 'prepare', error)
    return {
      kind: 'skip',
      perf,
      detail: {
        id: parsed.id,
        success: false,
        operation,
        blockId,
        reason: `pending 准备阶段异常: ${formatErrorMessage(error)}`,
      },
    }
  } finally {
    perf.totalMs = roundMs(nowMs() - prepareStartedAt)
  }
}

async function batchApplyNonInsertPendingRevisionsParallel(
  editor: Editor,
  revisions: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  const batchStartedAt = nowMs()
  const results: ApplyDetail[] = []
  if (revisions.length === 0) return results

  const prepareStartedAt = nowMs()
  const preparedResults = await Promise.all(
    revisions.map((parsed) => prepareNonInsertRevision(editor, parsed))
  )
  const prepareTotalMs = roundMs(nowMs() - prepareStartedAt)
  const prepared: PreparedNonInsertRevision[] = []
  const appliedPerf: AppliedRevisionPerf[] = []
  const megaTr: Transaction = editor.state.tr
  let missingBlockCount = 0
  const missingBlockSamples: string[] = []
  let dispatchMs = 0
  let registerMs = 0
  let fatalError: unknown

  try {
    const applyStartedAt = nowMs()

    for (const preparedResult of preparedResults) {
      if (preparedResult.kind === 'skip') {
        results.push(preparedResult.detail)
        if (preparedResult.missingBlockId) {
          missingBlockCount += 1
          if (missingBlockSamples.length < 10) missingBlockSamples.push(preparedResult.missingBlockId)
        }
        continue
      }

      const item = preparedResult.item
      const itemPerf = createAppliedRevisionPerf({
        id: item.parsed.id,
        blockId: item.blockId,
        operation: item.operation,
        planKind: item.plan.kind,
      })
      const itemStartedAt = nowMs()
      appliedPerf.push(itemPerf)

      try {
        let currentPos = measureAppliedStage(itemPerf, 'locateMs', () =>
          findCurrentRootBlockPosInTr(megaTr, item.initialBlockPos, item.blockId)
        )
        if (currentPos === null) {
          itemPerf.errorStage = 'locateMs'
          itemPerf.errorMessage = 'mega-tr 中无法定位目标块'
          pushFailedExecutionResult(results, item, 'mega-tr 中无法定位目标块')
          continue
        }

        measureAppliedStage(itemPerf, 'convertMs', () => {
          applyResolutionConversionToTr(megaTr, currentPos, item.resolution)
        })

        const executeResult = measureAppliedStage(itemPerf, 'executeMs', () =>
          executePendingPlanToTr({
            tr: megaTr,
            blockPos: currentPos,
            revisionId: item.revisionId,
            plan: item.plan,
            historyBlockId: createExecutionHistoryBlockId(item),
          })
        )

        if (!executeResult.success) {
          itemPerf.errorStage = 'executeMs'
          itemPerf.errorMessage = executeResult.reason || item.error || '应用执行计划到 mega-tr 失败'
          pushFailedExecutionResult(
            results,
            item,
            executeResult.reason || item.error || '应用执行计划到 mega-tr 失败'
          )
          continue
        }

        prepared.push(item)
        item.appliedDiffStats = executeResult.diffStats
        item.successReason = executeResult.reason
        itemPerf.success = true
        pushSuccessfulExecutionResult(results, item, executeResult.reason)
      } catch (error) {
        itemPerf.errorStage = itemPerf.errorStage ?? 'apply'
        itemPerf.errorMessage = itemPerf.errorMessage ?? formatErrorMessage(error)
        pushFailedExecutionResult(results, item, `pending 应用阶段异常: ${formatErrorMessage(error)}`)
      } finally {
        itemPerf.totalMs = roundMs(nowMs() - itemStartedAt)
      }
    }

    const applyTotalMs = roundMs(nowMs() - applyStartedAt)

    pushMissingBlockWarning(missingBlockCount, missingBlockSamples, revisions.length)

    markPendingRevisionProjectionTransaction(megaTr)
    if (megaTr.docChanged) {
      const dispatchStartedAt = nowMs()
      editor.view.dispatch(megaTr)
      dispatchMs = roundMs(dispatchMs + nowMs() - dispatchStartedAt)
    }

    const registerStartedAt = nowMs()
    registerPreparedRevisions(editor, prepared, results)
    registerMs = roundMs(registerMs + nowMs() - registerStartedAt)

    publishNonInsertBatchPerfReport(buildNonInsertBatchPerfReport({
      mode: 'parallel',
      requestedCount: revisions.length,
      prepared: preparedResults.map((item) => item.perf),
      applied: appliedPerf,
      totalMs: nowMs() - batchStartedAt,
      prepareTotalMs,
      applyTotalMs,
      dispatchMs,
      registerMs,
      repeatedTargetFallback: false,
      docChanged: megaTr.docChanged,
    }))
    return results
  } catch (error) {
    fatalError = error
    throw error
  } finally {
    if (fatalError != null) {
      publishNonInsertBatchPerfReport(buildNonInsertBatchPerfReport({
        mode: 'parallel',
        requestedCount: revisions.length,
        prepared: preparedResults.map((item) => item.perf),
        applied: appliedPerf,
        totalMs: nowMs() - batchStartedAt,
        prepareTotalMs,
        applyTotalMs: 0,
        dispatchMs,
        registerMs,
        repeatedTargetFallback: false,
        docChanged: megaTr.docChanged,
        fatalError,
      }))
    }
  }
}

async function batchApplyNonInsertPendingRevisionsSerial(
  editor: Editor,
  revisions: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  const results: ApplyDetail[] = []
  if (revisions.length === 0) return results

  const prepared: PreparedNonInsertRevision[] = []
  const megaTr: Transaction = editor.state.tr
  let missingBlockCount = 0
  const missingBlockSamples: string[] = []

  for (const parsed of revisions) {
    const { blockId, newMarkdown } = parsed
    const operation = getNonInsertOperation(parsed)

    if (!blockId) {
      results.push({
        id: parsed.id,
        success: false,
        operation,
        blockId,
        reason: `${operation} 操作缺少 blockId`,
      })
      continue
    }

    if (operation === 'delete') {
      const blockPos = findRootBlockPosByIdInDoc(megaTr.doc, blockId)
      if (blockPos === null) {
        results.push(createMissingBlockDetail(parsed, 'delete', blockId))
        continue
      }

      const currentRootBlockNode = megaTr.doc.nodeAt(blockPos)
      const currentContent = currentRootBlockNode ? linearizeNode(currentRootBlockNode) : null
      if (!currentRootBlockNode || !currentContent) {
        results.push({
          id: parsed.id,
          success: false,
          operation: 'delete',
          blockId,
          reason: `无法提取 blockId=${blockId} 的块内容`,
        })
        continue
      }

      const item: PreparedNonInsertRevision = {
        parsed,
        blockId,
        initialBlockPos: blockPos,
        revisionId: `ai-${parsed.id}`,
        operation,
        plan: buildDeleteExecutionPlan(currentContent.spans),
        perf: createPreparedRevisionPerf(parsed, operation),
      }

      const executeResult = executePendingPlanToTr({
        tr: megaTr,
        blockPos,
        revisionId: item.revisionId,
        plan: item.plan,
      })

      if (!executeResult.success) {
        pushFailedExecutionResult(
          results,
          item,
          executeResult.reason || '应用执行计划到 mega-tr 失败'
        )
        continue
      }

      item.appliedDiffStats = executeResult.diffStats
      item.successReason = executeResult.reason
      prepared.push(item)
      pushSuccessfulExecutionResult(results, item, executeResult.reason)
      continue
    }

    const citationHydration = readCitationHydrationMetadata(parsed)
    const hydrationPrepared = await processCitationHydration(
      newMarkdown || '',
      citationHydration,
      { operation: 'batchApplyUpdatePendingRevisions', blockId }
    )
    const processedMarkdown = hydrationPrepared.markdown

    let blockPos = findRootBlockPosByIdInDoc(megaTr.doc, blockId)
    if (blockPos === null) {
      missingBlockCount += 1
      if (missingBlockSamples.length < 10) missingBlockSamples.push(blockId)

      results.push(createMissingBlockDetail(parsed, operation, blockId))
      continue
    }

    const resolution = await resolvePendingMarkdownForSingleBlock(editor, processedMarkdown, {
      operation: 'batchApplyUpdatePendingRevisions',
      blockId,
      hydration: hydrationPrepared.hydration,
    })
    applyResolutionConversionToTr(megaTr, blockPos, resolution)

    blockPos = findRootBlockPosByIdInDoc(megaTr.doc, blockId)
    if (blockPos === null) {
      results.push({
        id: parsed.id,
        success: false,
        operation,
        blockId,
        reason: '类型转换后无法找到目标块',
      })
      continue
    }

    const currentRootBlockNode = megaTr.doc.nodeAt(blockPos)
    const currentContent = currentRootBlockNode ? linearizeNode(currentRootBlockNode) : null
    if (!currentContent || !currentRootBlockNode) {
      results.push({
        id: parsed.id,
        success: false,
        operation,
        blockId,
        reason: `无法提取 blockId=${blockId} 的块内容`,
      })
      continue
    }

    const item: PreparedNonInsertRevision = {
      parsed,
      blockId,
      initialBlockPos: blockPos,
      revisionId: `ai-${parsed.id}`,
      operation,
      resolution,
      plan: await buildUpdateExecutionPlan({
        resolution,
        currentSpans: currentContent.spans,
        processedMarkdown,
        blockId,
        hydration: hydrationPrepared.hydration,
        operation: 'batchApplyUpdatePendingRevisions',
      }),
      perf: createPreparedRevisionPerf(parsed, operation),
    }

    const currentPos = findRootBlockPosByIdInDoc(megaTr.doc, item.blockId)
    if (currentPos === null) {
      pushFailedExecutionResult(results, item, 'mega-tr 中无法定位目标块')
      continue
    }

    const executeResult = executePendingPlanToTr({
      tr: megaTr,
      blockPos: currentPos,
      revisionId: item.revisionId,
      plan: item.plan,
      historyBlockId: createExecutionHistoryBlockId(item),
    })

    if (!executeResult.success) {
      pushFailedExecutionResult(
        results,
        item,
        executeResult.reason || item.error || '应用执行计划到 mega-tr 失败'
      )
      continue
    }

    prepared.push(item)
    item.appliedDiffStats = executeResult.diffStats
    item.successReason = executeResult.reason
    pushSuccessfulExecutionResult(results, item, executeResult.reason)
  }

  pushMissingBlockWarning(missingBlockCount, missingBlockSamples, revisions.length)

  markPendingRevisionProjectionTransaction(megaTr)
  if (megaTr.docChanged) {
    editor.view.dispatch(megaTr)
  }

  registerPreparedRevisions(editor, prepared, results)
  return results
}

export async function batchApplyNonInsertPendingRevisions(
  editor: Editor,
  revisions: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  if (hasRepeatedTargetBlock(revisions)) {
    // 中文说明：同一个 block 连续 pending 需要严格复用演进中的 megaTr doc。
    // 这类数据不是大文档可见窗口的主路径，保留旧串行语义比并行猜测更稳。
    return batchApplyNonInsertPendingRevisionsSerial(editor, revisions)
  }

  return batchApplyNonInsertPendingRevisionsParallel(editor, revisions)
}

export async function batchApplyUpdatePendingRevisions(
  editor: Editor,
  updates: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  return batchApplyNonInsertPendingRevisions(editor, updates)
}
