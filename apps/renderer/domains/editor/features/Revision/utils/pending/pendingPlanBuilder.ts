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
