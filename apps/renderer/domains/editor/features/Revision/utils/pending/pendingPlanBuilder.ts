import type { Node as ProseMirrorNode } from 'prosemirror-model'

import type { InsertedTextNewlineMode } from '../diffApplier'
import { computeRichDiff } from '../richDiff'
import type { TextSpan } from '../../protocol/revisionTextSpanTypes'
import { attachCitationHydrationToSpans } from './citationHydrationHelper'
import { parsePendingMarkdownToInlineProjection } from './pendingMarkdownRuntime'
import type {
  PendingContentBlockResolution,
  PendingMarkdownResolutionResult,
} from './pendingRevisionHelpers'
import type { PendingExecutionPlan } from './pendingExecutionPlan'

function buildContentDiffPlan(params: {
  currentSpans: TextSpan[]
  newSpans: TextSpan[]
  insertNewlineMode: InsertedTextNewlineMode
}): PendingExecutionPlan {
  return {
    kind: 'content-diff',
    richDiff: computeRichDiff(params.currentSpans, params.newSpans),
    insertNewlineMode: params.insertNewlineMode,
  }
}

export function buildDeleteExecutionPlan(currentSpans: TextSpan[]): PendingExecutionPlan {
  return buildContentDiffPlan({
    currentSpans,
    newSpans: [],
    insertNewlineMode: 'hardBreak',
  })
}

/**
 * 删除目标是原子内容块（如水平分割线）时，没有行内文字可打删除标记：
 * 文档保持不变，只登记一次整块删除，不能当作“内容已为空”而静默跳过。
 */
export function buildDeleteExecutionPlanForRootBlock(
  rootBlock: ProseMirrorNode,
  currentSpans: TextSpan[]
): PendingExecutionPlan {
  return rootBlock.firstChild?.isAtom
    ? { kind: 'block-remove' }
    : buildDeleteExecutionPlan(currentSpans)
}

export function buildInsertExecutionPlan(params: {
  resolution: PendingMarkdownResolutionResult
  currentSpans: TextSpan[]
  currentPlainText: string
  hydration: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
}): PendingExecutionPlan {
  if (params.resolution.kind === 'table-block') {
    return {
      kind: 'table-insert',
      tableRows: params.resolution.tableRowsResult.rows,
    }
  }

  if (params.resolution.kind === 'atomic-block') {
    return { kind: 'block-replace', contentBlock: params.resolution.contentBlock }
  }

  const { spans, insertNewlineMode } = resolveContentSpansForPlan(
    params.resolution,
    params.hydration
  )

  return buildContentDiffPlan({
    currentSpans: params.currentPlainText.trim() === '' ? [] : params.currentSpans,
    newSpans: spans,
    insertNewlineMode,
  })
}

export async function buildUpdateExecutionPlan(params: {
  resolution: PendingMarkdownResolutionResult
  currentSpans: TextSpan[]
  processedMarkdown: string
  blockId: string
  hydration: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
  operation: string
}): Promise<PendingExecutionPlan> {
  if (params.resolution.kind === 'table-block') {
    return {
      kind: 'table-update-with-history',
      tableRows: params.resolution.tableRowsResult.rows,
      fallbackRichDiff: computeRichDiff(
        params.currentSpans,
        attachCitationHydrationToSpans(
          (
            await parsePendingMarkdownToInlineProjection(params.processedMarkdown, {
              operation: `${params.operation}.tableFallback`,
              blockId: params.blockId,
            })
          ).spans,
          params.hydration
        )
      ),
    }
  }

  if (params.resolution.kind === 'atomic-block') {
    return { kind: 'block-replace', contentBlock: params.resolution.contentBlock }
  }

  const { spans, insertNewlineMode } = resolveContentSpansForPlan(
    params.resolution,
    params.hydration
  )

  return buildContentDiffPlan({
    currentSpans: params.currentSpans,
    newSpans: spans,
    insertNewlineMode,
  })
}

function resolveContentSpansForPlan(
  resolution: PendingContentBlockResolution,
  hydration: Record<string, import('@/shared/utils/citationHydration').CitationHydrationData> | null
): { spans: TextSpan[]; insertNewlineMode: InsertedTextNewlineMode } {
  return {
    spans:
      resolution.contentType === 'codeBlock'
        ? resolution.spans
        : attachCitationHydrationToSpans(resolution.spans, hydration),
    insertNewlineMode: resolution.contentType === 'codeBlock' ? 'literalText' : 'hardBreak',
  }
}
