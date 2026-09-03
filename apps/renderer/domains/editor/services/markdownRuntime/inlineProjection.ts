import type { Node as ProseMirrorNode, Schema } from 'prosemirror-model'

import { generateBlockId } from '../../../../shared/utils/idUtils'
import type { TextSpan } from '../../features/Revision/protocol/revisionTextSpanTypes'
import type {
  BlockEventLike,
  ContentFragmentLike,
  InlineProjectionOptions,
  MarkLike,
  MarkdownInlineFragment,
  MarkdownInlineProjection,
  SupportedInlineMarkName,
} from './types'

const SUPPORTED_SPAN_MARKS = new Set<SupportedInlineMarkName>(['bold', 'italic', 'strike', 'code'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMarkArray(value: unknown): MarkLike[] {
  if (!Array.isArray(value)) {
    return []
  }

  const marks: MarkLike[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string') {
      continue
    }
    marks.push({
      type: item.type,
      attrs: isRecord(item.attrs) ? item.attrs : undefined,
    })
  }

  return marks
}

function pickSupportedSpanMarks(marks: MarkLike[]): SupportedInlineMarkName[] {
  const selected: SupportedInlineMarkName[] = []

  for (const mark of marks) {
    if (SUPPORTED_SPAN_MARKS.has(mark.type as SupportedInlineMarkName)) {
      selected.push(mark.type as SupportedInlineMarkName)
    }
  }

  return Array.from(new Set(selected))
}

function inlineAtomEqual(
  left: TextSpan['inlineAtom'] | undefined,
  right: TextSpan['inlineAtom'] | undefined
): boolean {
  if (!left && !right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeAdjacentSpans(spans: TextSpan[]): TextSpan[] {
  const merged: TextSpan[] = []

  for (const span of spans) {
    if (!span.text) {
      continue
    }

    const last = merged[merged.length - 1]
    const sameMarks =
      last &&
      last.marks.length === span.marks.length &&
      last.marks.every(mark => span.marks.includes(mark))
    const sameInlineAtom = inlineAtomEqual(last?.inlineAtom, span.inlineAtom)

    if (
      last &&
      sameMarks &&
      sameInlineAtom &&
      !last.citation &&
      !span.citation &&
      !span.inlineAtom
    ) {
      last.text += span.text
      continue
    }

    merged.push({
      text: span.text,
      marks: [...span.marks],
      citation: span.citation,
      inlineAtom: span.inlineAtom,
    })
  }

  return merged
}

function projectionFromFragments(
  fragments: MarkdownInlineFragment[],
  sourceBlockCount: number,
  droppedBlockCount: number
): MarkdownInlineProjection {
  const spans: TextSpan[] = []

  for (const fragment of fragments) {
    if (fragment.type === 'text') {
      spans.push({
        text: fragment.text,
        marks: pickSupportedSpanMarks(fragment.marks),
      })
      continue
    }

    if (fragment.type === 'hardBreak') {
      spans.push({
        text: '\n',
        marks: pickSupportedSpanMarks(fragment.marks),
      })
      continue
    }

    if (fragment.type === 'citationNode') {
      spans.push({
        text: fragment.textRepresentation,
        marks: pickSupportedSpanMarks(fragment.marks),
        citation: fragment.citation,
        inlineAtom: {
          type: 'citation',
          citation: fragment.citation,
          textRepresentation: fragment.textRepresentation,
        },
      })
      continue
    }

    spans.push({
      text: fragment.textRepresentation,
      marks: [],
      inlineAtom: {
        type: 'inlineLatex',
        latexSource: fragment.latexSource,
        textRepresentation: fragment.textRepresentation,
        attrs: fragment.attrs,
      },
    })
  }

  const mergedSpans = mergeAdjacentSpans(spans)

  return {
    fragments,
    spans: mergedSpans,
    plainText: mergedSpans.map(span => span.text).join(''),
    newlineMode: 'hardBreak',
    sourceBlockCount,
    droppedBlockCount,
  }
}

export function structuredContentToInlineProjection(
  structured: ContentFragmentLike[] | null | undefined,
  rawFallback: string | null | undefined,
  sourceBlockCount = 1,
  droppedBlockCount = 0
): MarkdownInlineProjection {
  const fragments: MarkdownInlineFragment[] = []

  if (Array.isArray(structured)) {
    for (const fragment of structured) {
      if (!fragment || typeof fragment !== 'object') {
        continue
      }

      if (fragment.type === 'text') {
        const text = typeof fragment.text === 'string' ? fragment.text : ''
        if (!text) {
          continue
        }

        fragments.push({
          type: 'text',
          text,
          marks: toMarkArray(fragment.marks),
        })
        continue
      }

      if (fragment.type === 'hardBreak') {
        fragments.push({
          type: 'hardBreak',
          marks: toMarkArray(fragment.marks),
        })
        continue
      }

      if (fragment.type === 'inlineLatex') {
        const attrs = isRecord(fragment.attrs) ? fragment.attrs : {}
        const latexSource = typeof attrs.latexSource === 'string' ? attrs.latexSource : ''

        fragments.push({
          type: 'inlineLatex',
          attrs,
          latexSource,
          textRepresentation: latexSource ? `$${latexSource}$` : '$$',
        })
        continue
      }

      if (fragment.type === 'citationNode') {
        // CitationNode 只会由 hydration 注入；结构化 parser 的无 admission attrs 不能创建引用事实。
        continue
      }
    }
  }

  if (fragments.length === 0 && typeof rawFallback === 'string' && rawFallback.length > 0) {
    fragments.push({
      type: 'text',
      text: rawFallback,
      marks: [],
    })
  }

  return projectionFromFragments(fragments, sourceBlockCount, droppedBlockCount)
}

export function blockEventToInlineProjection(blockEvent: BlockEventLike): MarkdownInlineProjection {
  return structuredContentToInlineProjection(
    Array.isArray(blockEvent?.structured_content)
      ? (blockEvent.structured_content as ContentFragmentLike[])
      : null,
    typeof blockEvent?.raw_content_fallback === 'string' ? blockEvent.raw_content_fallback : null
  )
}

export function blockEventsToInlineProjection(
  events: BlockEventLike[],
  options: InlineProjectionOptions = {}
): MarkdownInlineProjection {
  if (!Array.isArray(events) || events.length === 0) {
    return projectionFromFragments([], 0, 0)
  }

  const { multiBlockMode = 'join-blocks', blockSeparator = '\n\n', onDroppedBlocks } = options

  if (multiBlockMode === 'first-block') {
    const firstEvent = events[0]
    const droppedBlockCount = Math.max(0, events.length - 1)

    if (droppedBlockCount > 0) {
      onDroppedBlocks?.({
        requestedBlockCount: events.length,
        usedBlockCount: 1,
        droppedBlockCount,
      })
    }

    return structuredContentToInlineProjection(
      Array.isArray(firstEvent?.structured_content)
        ? (firstEvent.structured_content as ContentFragmentLike[])
        : null,
      typeof firstEvent?.raw_content_fallback === 'string' ? firstEvent.raw_content_fallback : null,
      1,
      droppedBlockCount
    )
  }

  const fragments: MarkdownInlineFragment[] = []

  for (let index = 0; index < events.length; index += 1) {
    const projection = blockEventToInlineProjection(events[index])
    fragments.push(...projection.fragments)

    if (index < events.length - 1 && blockSeparator.length > 0) {
      fragments.push({
        type: 'text',
        text: blockSeparator,
        marks: [],
      })
    }
  }

  return projectionFromFragments(fragments, events.length, 0)
}

export function blockEventsToTextSpans(
  events: BlockEventLike[],
  options?: InlineProjectionOptions
): TextSpan[] {
  return blockEventsToInlineProjection(events, options).spans
}

function buildSchemaMarks(schema: Schema, marks: MarkLike[]) {
  const result = []

  for (const mark of marks) {
    const markType = schema.marks[mark.type]
    if (!markType) {
      continue
    }
    result.push(markType.create(isRecord(mark.attrs) ? mark.attrs : undefined))
  }

  return result
}

export function buildInlineNodesFromProjection(
  projection: MarkdownInlineProjection,
  schema: Schema
): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []

  for (const fragment of projection.fragments) {
    if (fragment.type === 'text') {
      const marks = buildSchemaMarks(schema, fragment.marks)
      nodes.push(schema.text(fragment.text, marks.length > 0 ? marks : undefined))
      continue
    }

    if (fragment.type === 'hardBreak') {
      const marks = buildSchemaMarks(schema, fragment.marks)
      const hardBreakType = schema.nodes.hardBreak
      if (hardBreakType) {
        nodes.push(hardBreakType.create(null, null, marks))
      } else {
        nodes.push(schema.text('\n', marks.length > 0 ? marks : undefined))
      }
      continue
    }

    if (fragment.type === 'citationNode') {
      const citationNodeType = schema.nodes.citationNode
      if (!citationNodeType) {
        throw new Error('Markdown runtime 无法物化 citation：schema 未注册 CitationNode。')
      }
      nodes.push(
        citationNodeType.create(fragment.attrs, null, buildSchemaMarks(schema, fragment.marks))
      )
      continue
    }

    const inlineLatexType = schema.nodes.inlineLatex
    if (!inlineLatexType) {
      nodes.push(schema.text(fragment.textRepresentation))
      continue
    }

    try {
      nodes.push(
        inlineLatexType.create({
          id: generateBlockId(),
          ...fragment.attrs,
          latexSource: fragment.latexSource,
        })
      )
    } catch {
      nodes.push(schema.text(fragment.textRepresentation))
    }
  }

  return nodes
}

export function buildInlineNodesFromStructuredContent(
  structured: ContentFragmentLike[] | null | undefined,
  rawFallback: string | null | undefined,
  schema: Schema
): ProseMirrorNode[] | null {
  const projection = structuredContentToInlineProjection(structured, rawFallback)
  if (projection.fragments.length === 0) {
    return null
  }

  return buildInlineNodesFromProjection(projection, schema)
}
