/** Pending Markdown citation admission -> Revision Citation atom 投影。 */
import {
  parseMarkdownCitationTokens,
  projectMarkdownCitationTokens,
} from '@linnya/citation-domain/markdown-reference'
import type { CitationHydrationData } from '@/shared/utils/citationHydration'
import type {
  MarkdownInlineFragment,
  MarkdownInlineProjection,
} from '../../../../services/markdownRuntime/types'
import type { CitationInlineMeta, MarkName, TextSpan } from '../../protocol/revisionTextSpanTypes'
import { infoRevisionDebug } from '../revisionDebugLogging'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCitationHydrationData(value: unknown): value is CitationHydrationData {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.snippet !== 'string') {
    return false
  }
  if (value.kbId !== undefined && typeof value.kbId !== 'string') return false
  if (value.blockId !== undefined && typeof value.blockId !== 'string') return false
  if (value.url !== undefined && typeof value.url !== 'string') return false
  if (value.date !== undefined && typeof value.date !== 'string') return false
  if (value.containerTitle !== undefined && typeof value.containerTitle !== 'string') return false
  if (
    value.authors !== undefined &&
    (!Array.isArray(value.authors) || value.authors.some(author => typeof author !== 'string'))
  ) {
    return false
  }

  const sourceType =
    value.sourceType === 'web' || value.sourceType === 'manual'
      ? value.sourceType
      : 'knowledge_base'
  if (value.sourceType !== undefined && value.sourceType !== sourceType) return false
  if (sourceType === 'knowledge_base') {
    return (
      typeof value.docId === 'string' &&
      value.docId.trim().length > 0 &&
      typeof value.blockId === 'string' &&
      value.blockId.trim().length > 0
    )
  }
  if (sourceType === 'web') return typeof value.url === 'string' && value.url.trim().length > 0
  return (
    (typeof value.docId === 'string' && value.docId.trim().length > 0) ||
    (typeof value.url === 'string' && value.url.trim().length > 0)
  )
}

function narrowCitationHydrationRecord(
  input: Record<string, unknown>
): Record<string, CitationHydrationData> {
  const result: Record<string, CitationHydrationData> = {}
  for (const [ref, value] of Object.entries(input)) {
    if (!isCitationHydrationData(value)) {
      console.warn(`[citationHydrationHelper] 非法 hydration 条目，已忽略 ref=${ref}`)
      continue
    }
    result[ref] = value
  }
  return result
}

function normalizeCitationExpressions(markdown: string): string {
  return projectMarkdownCitationTokens({
    markdown,
    resolveRef: ref => `[@${ref}]`,
  })
}

export interface CitationHydrationProcessResult {
  markdown: string
  hydration: Record<string, CitationHydrationData> | null
}

export async function processCitationHydration(
  markdown: string,
  citationHydration: Record<string, unknown> | undefined,
  context: { operation: string; blockId: string }
): Promise<CitationHydrationProcessResult> {
  if (
    !citationHydration ||
    Object.keys(citationHydration).length === 0 ||
    !markdown.includes('[@')
  ) {
    return { markdown, hydration: null }
  }
  const hydration = narrowCitationHydrationRecord(citationHydration)
  if (Object.keys(hydration).length === 0) return { markdown, hydration: null }
  const normalized = normalizeCitationExpressions(markdown)
  infoRevisionDebug(
    `[${context.operation}] citation hydration 已接纳: count=${Object.keys(hydration).length}, blockId=${context.blockId}`
  )
  return { markdown: normalized, hydration }
}

function toCitationMeta(data: CitationHydrationData, ref: string): CitationInlineMeta {
  const sourceType =
    data.sourceType === 'web' || data.sourceType === 'manual' ? data.sourceType : 'knowledge_base'
  const sourceId =
    sourceType === 'web'
      ? data.url
      : sourceType === 'manual'
        ? (data.docId ?? data.url)
        : data.docId
  if (!sourceId) throw new Error(`Citation [@${ref}] 缺少稳定 sourceId。`)
  return {
    ref,
    sourceType,
    sourceId,
    title: data.title,
    snippet: data.snippet,
    ...(data.kbId ? { kbId: data.kbId } : {}),
    ...(data.blockId ? { blockId: data.blockId } : {}),
    ...(data.url ? { url: data.url } : {}),
    ...(data.date ? { date: data.date } : {}),
    ...(data.authors && data.authors.length > 0 ? { authors: [...data.authors] } : {}),
    ...(data.containerTitle ? { containerTitle: data.containerTitle } : {}),
  }
}

function buildCitationNodeAttrs(citation: CitationInlineMeta): Record<string, unknown> {
  return {
    citationId: crypto.randomUUID(),
    ref: citation.ref,
    sourceType: citation.sourceType ?? 'knowledge_base',
    sourceId: citation.sourceId,
    kbId: citation.kbId ?? null,
    blockId: citation.blockId ?? null,
    title: citation.title,
    snippet: citation.snippet,
    snippets: null,
    authors: citation.authors ?? null,
    date: citation.date ?? null,
    url: citation.url ?? null,
    containerTitle: citation.containerTitle ?? null,
  }
}

function sameMarks(left: MarkName[], right: MarkName[]): boolean {
  return left.length === right.length && left.every(mark => right.includes(mark))
}

function appendTextSpan(target: TextSpan[], text: string, marks: MarkName[]): void {
  if (!text) return
  const last = target[target.length - 1]
  if (last && !last.inlineAtom && !last.citation && sameMarks(last.marks, marks)) {
    last.text += text
    return
  }
  target.push({ text, marks: [...marks] })
}

export function attachCitationHydrationToSpans(
  spans: TextSpan[],
  hydration: Record<string, CitationHydrationData> | null
): TextSpan[] {
  if (!hydration || Object.keys(hydration).length === 0) return spans
  const result: TextSpan[] = []

  for (const span of spans) {
    if (span.inlineAtom || span.marks.includes('code')) {
      result.push(span)
      continue
    }
    let cursor = 0
    for (const token of parseMarkdownCitationTokens(span.text)) {
      appendTextSpan(result, span.text.slice(cursor, token.start), span.marks)
      for (const ref of token.refs) {
        const data = hydration[ref]
        const portableText = `[@${ref}]`
        if (!data) {
          appendTextSpan(result, portableText, span.marks)
          continue
        }
        const citation = toCitationMeta(data, ref)
        result.push({
          text: portableText,
          marks: [...span.marks],
          citation,
          inlineAtom: { type: 'citation', citation, textRepresentation: portableText },
        })
      }
      cursor = token.end
    }
    appendTextSpan(result, span.text.slice(cursor), span.marks)
  }
  return result
}

function hydrateTextFragment(
  fragment: Extract<MarkdownInlineFragment, { type: 'text' }>,
  hydration: Record<string, CitationHydrationData>
): MarkdownInlineFragment[] {
  if (fragment.marks.some(mark => mark.type === 'code')) return [fragment]
  const result: MarkdownInlineFragment[] = []
  let cursor = 0
  for (const token of parseMarkdownCitationTokens(fragment.text)) {
    if (token.start > cursor) {
      result.push({ ...fragment, text: fragment.text.slice(cursor, token.start) })
    }
    for (const ref of token.refs) {
      const portableText = `[@${ref}]`
      const data = hydration[ref]
      if (!data) {
        result.push({ ...fragment, text: portableText })
        continue
      }
      const citation = toCitationMeta(data, ref)
      result.push({
        type: 'citationNode',
        attrs: buildCitationNodeAttrs(citation),
        citation,
        marks: fragment.marks.map(mark => ({
          type: mark.type,
          ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
        })),
        textRepresentation: portableText,
      })
    }
    cursor = token.end
  }
  if (cursor < fragment.text.length) {
    result.push({ ...fragment, text: fragment.text.slice(cursor) })
  }
  return result.length > 0 ? result : [fragment]
}

export function attachCitationHydrationToProjection(
  projection: MarkdownInlineProjection,
  hydration: Record<string, CitationHydrationData> | null
): MarkdownInlineProjection {
  if (!hydration || Object.keys(hydration).length === 0) return projection
  const fragments = projection.fragments.flatMap(fragment =>
    fragment.type === 'text' ? hydrateTextFragment(fragment, hydration) : [fragment]
  )
  const spans = attachCitationHydrationToSpans(projection.spans, hydration)
  return {
    ...projection,
    fragments,
    spans,
    plainText: spans.map(span => span.text).join(''),
  }
}
