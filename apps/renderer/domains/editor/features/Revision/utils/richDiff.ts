/**
 * @file richDiff.ts
 * @description Rich Diff 生成器
 *
 * 在纯文本 diff 的基础上，为 insert 段附加 marks 信息。
 * 用于 AI Edit 场景下，让新插入的文本能够带上 Markdown 中指定的格式。
 */

import { computeTextDiff, computeDiffStats, type DiffSegment, type DiffStats } from './diffUtils'
import type {
  CitationInlineMeta,
  InlineAtom,
  MarkName,
  TextSpan,
} from '../protocol/revisionTextSpanTypes'

// ==================== 类型定义 ====================

/** 带 marks 信息的 Diff 片段 */
export interface RichDiffSegment {
  /** 变更类型 */
  type: 'equal' | 'insert' | 'delete'
  /** 文本内容 */
  text: string
  /** ProseMirror 位置长度：文字按 UTF-16，inline atom 为 1；不同于 diff 的字符单元数。 */
  documentSize?: number
  /** 该片段的 marks（仅 insert 有意义） */
  marks?: MarkName[]
  /** 可选：citation 元数据（仅 insert 有意义） */
  citation?: CitationInlineMeta
  /** 可选：结构化 inline 原子节点语义（inlineLatex / citation） */
  inlineAtom?: InlineAtom
}

/** Rich Diff 计算结果 */
export interface RichDiffResult {
  /** Diff 片段序列 */
  segments: RichDiffSegment[]
  /** Diff 统计信息 */
  stats: DiffStats
}

type ComparableUnit = {
  /** 比较层稳定键：相同语义 -> 相同 key */
  compareKey: string
  /** 渲染/应用到文档时使用的原始文本 */
  text: string
  /** 当前单元携带的 marks */
  marks: MarkName[]
  /** 当前单元携带的 citation 元数据 */
  citation?: CitationInlineMeta
  /** 当前单元携带的结构化 inline 原子节点 */
  inlineAtom?: InlineAtom
}

// ==================== 核心逻辑 ====================

function citationEqual(
  a: CitationInlineMeta | undefined,
  b: CitationInlineMeta | undefined
): boolean {
  return (
    a?.ref === b?.ref &&
    a?.sourceType === b?.sourceType &&
    a?.sourceId === b?.sourceId &&
    a?.title === b?.title &&
    a?.snippet === b?.snippet &&
    a?.kbId === b?.kbId &&
    a?.blockId === b?.blockId &&
    a?.url === b?.url &&
    a?.date === b?.date &&
    a?.containerTitle === b?.containerTitle &&
    JSON.stringify(a?.authors ?? []) === JSON.stringify(b?.authors ?? [])
  )
}

function inlineAtomEqual(a: InlineAtom | undefined, b: InlineAtom | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 比较层语义相等：
 * - 忽略 ref，因为 doc 侧通常只有 existing-citation，而 markdown hydration 侧是 @xxx；
 * - 只要真正语义载荷一致，就应视为同一 citation。
 */
function citationSemanticEqual(
  a: CitationInlineMeta | undefined,
  b: CitationInlineMeta | undefined
): boolean {
  return (
    a?.sourceType === b?.sourceType &&
    a?.sourceId === b?.sourceId &&
    a?.title === b?.title &&
    a?.snippet === b?.snippet &&
    a?.kbId === b?.kbId &&
    a?.blockId === b?.blockId &&
    a?.url === b?.url &&
    a?.date === b?.date &&
    a?.containerTitle === b?.containerTitle &&
    JSON.stringify(a?.authors ?? []) === JSON.stringify(b?.authors ?? [])
  )
}

function inlineEqual(
  oldMarks: MarkName[] | undefined,
  newMarks: MarkName[] | undefined,
  oldCitation: CitationInlineMeta | undefined,
  newCitation: CitationInlineMeta | undefined
): boolean {
  return marksArrayEqual(oldMarks, newMarks) && citationSemanticEqual(oldCitation, newCitation)
}

function buildDiffSignature(
  oldMarks: MarkName[] | undefined,
  newMarks: MarkName[] | undefined,
  oldCitation: CitationInlineMeta | undefined,
  newCitation: CitationInlineMeta | undefined
): string {
  const oldKey = (oldMarks ?? []).slice().sort().join('|')
  const newKey = (newMarks ?? []).slice().sort().join('|')
  const oldCitationKey = oldCitation
    ? `${oldCitation.sourceType ?? ''}::${oldCitation.sourceId}::${oldCitation.title}::${oldCitation.snippet}::${oldCitation.kbId ?? ''}::${oldCitation.blockId ?? ''}::${oldCitation.url ?? ''}::${oldCitation.date ?? ''}::${oldCitation.containerTitle ?? ''}::${JSON.stringify(oldCitation.authors ?? [])}`
    : ''
  const newCitationKey = newCitation
    ? `${newCitation.sourceType ?? ''}::${newCitation.sourceId}::${newCitation.title}::${newCitation.snippet}::${newCitation.kbId ?? ''}::${newCitation.blockId ?? ''}::${newCitation.url ?? ''}::${newCitation.date ?? ''}::${newCitation.containerTitle ?? ''}::${JSON.stringify(newCitation.authors ?? [])}`
    : ''
  return `${oldKey}=>${newKey}__${oldCitationKey}=>${newCitationKey}`
}

function buildCitationCompareKey(citation: CitationInlineMeta): string {
  return [
    citation.sourceType ?? '',
    citation.sourceId,
    citation.title,
    citation.snippet,
    citation.kbId ?? '',
    citation.blockId ?? '',
    citation.url ?? '',
    citation.date ?? '',
    citation.containerTitle ?? '',
    JSON.stringify(citation.authors ?? []),
  ].join('::')
}

function buildInlineAtomCompareKey(inlineAtom: InlineAtom): string {
  if (inlineAtom.type === 'citation') {
    return `citation:${buildCitationCompareKey(inlineAtom.citation)}`
  }
  return `${inlineAtom.type}:${JSON.stringify(inlineAtom)}`
}

/**
 * 把 spans 转成“可比较单元”：
 * - 普通文本按字符拆分，保持字符级 diff 精度；
 * - citation 与 inlineLatex 都按整个 span 视为原子单元。
 *
 * 这样可以把“显示层文本”和“比较层语义”解耦：
 * - 比较层：同一个 citation 视为同一单元；
 * - 应用层：仍保留各自原始文本，insert 时继续插入 markdown 侧文本。
 */
function buildComparableUnits(spans: TextSpan[]): ComparableUnit[] {
  const units: ComparableUnit[] = []

  for (const span of spans) {
    if (span.inlineAtom) {
      units.push({
        compareKey: `inlineAtom:${buildInlineAtomCompareKey(span.inlineAtom)}`,
        text: span.text,
        marks: [...span.marks],
        citation: span.citation,
        inlineAtom: span.inlineAtom,
      })
      continue
    }

    if (span.citation) {
      units.push({
        compareKey: `citation:${buildCitationCompareKey(span.citation)}`,
        text: span.text,
        marks: [...span.marks],
        citation: span.citation,
      })
      continue
    }

    for (const ch of span.text) {
      units.push({
        compareKey: `char:${ch}`,
        text: ch,
        marks: [...span.marks],
      })
    }
  }

  return units
}

function encodeComparableUnits(
  originalUnits: ComparableUnit[],
  newUnits: ComparableUnit[]
): { originalEncoded: string; newEncoded: string } {
  const keyToChar = new Map<string, string>()
  let nextCodePoint = 0xe000

  const getCharForKey = (key: string): string => {
    const existing = keyToChar.get(key)
    if (existing) return existing
    const ch = String.fromCharCode(nextCodePoint)
    keyToChar.set(key, ch)
    nextCodePoint += 1
    return ch
  }

  const originalEncoded = originalUnits.map(unit => getCharForKey(unit.compareKey)).join('')
  const newEncoded = newUnits.map(unit => getCharForKey(unit.compareKey)).join('')
  return { originalEncoded, newEncoded }
}

/** 比较用的字符编号不能直接充当 PM 位置；emoji 有两个 UTF-16 单元，公式与引用只有一个。 */
function documentSizeOf(units: ComparableUnit[]): number {
  return units.reduce((size, unit) => size + (unit.inlineAtom || unit.citation ? 1 : unit.text.length), 0)
}

function concatUnitText(units: ComparableUnit[]): string {
  return units.map(unit => unit.text).join('')
}

function pushRichSegment(target: RichDiffSegment[], segment: RichDiffSegment): void {
  if (!segment.text && !segment.inlineAtom) return
  const last = target[target.length - 1]
  const sameType = last?.type === segment.type
  const sameMarks = marksArrayEqual(last?.marks, segment.marks)
  const sameCitationMeta = citationEqual(last?.citation, segment.citation)
  const sameInlineAtom = inlineAtomEqual(last?.inlineAtom, segment.inlineAtom)

  if (last && sameType && sameMarks && sameCitationMeta && sameInlineAtom) {
    last.text += segment.text
    last.documentSize = (last.documentSize ?? 0) + (segment.documentSize ?? 0)
    return
  }

  target.push(segment)
}

function appendGroupedInsertUnits(target: RichDiffSegment[], units: ComparableUnit[]): void {
  if (units.length === 0) return

  let start = 0
  while (start < units.length) {
    const base = units[start]
    let end = start + 1
    while (end < units.length) {
      const next = units[end]
      if (
        !marksArrayEqual(base.marks, next.marks) ||
        !citationEqual(base.citation, next.citation) ||
        !inlineAtomEqual(base.inlineAtom, next.inlineAtom)
      ) {
        break
      }
      end += 1
    }

    pushRichSegment(target, {
      type: 'insert',
      text: concatUnitText(units.slice(start, end)),
      documentSize: documentSizeOf(units.slice(start, end)),
      marks: base.marks.length > 0 ? [...base.marks] : undefined,
      citation: base.citation,
      inlineAtom: base.inlineAtom,
    })

    start = end
  }
}

function buildRichSegmentsFromComparableUnits(
  basicSegments: DiffSegment[],
  originalUnits: ComparableUnit[],
  newUnits: ComparableUnit[]
): RichDiffSegment[] {
  const result: RichDiffSegment[] = []
  let originalCursor = 0
  let newCursor = 0

  for (const seg of basicSegments) {
    const unitCount = seg.text.length

    if (seg.type === 'delete') {
      const deletedUnits = originalUnits.slice(originalCursor, originalCursor + unitCount)
      pushRichSegment(result, {
        type: 'delete',
        text: concatUnitText(deletedUnits),
        documentSize: documentSizeOf(deletedUnits),
      })
      originalCursor += unitCount
      continue
    }

    if (seg.type === 'insert') {
      const insertedUnits = newUnits.slice(newCursor, newCursor + unitCount)
      appendGroupedInsertUnits(result, insertedUnits)
      newCursor += unitCount
      continue
    }

    const equalOriginalUnits = originalUnits.slice(originalCursor, originalCursor + unitCount)
    const equalNewUnits = newUnits.slice(newCursor, newCursor + unitCount)

    let groupStart = 0
    while (groupStart < unitCount) {
      const oldUnit = equalOriginalUnits[groupStart]
      const newUnit = equalNewUnits[groupStart]
      const sameInline = inlineEqual(
        oldUnit?.marks ?? [],
        newUnit?.marks ?? [],
        oldUnit?.citation,
        newUnit?.citation
      )
      const currentSignature = buildDiffSignature(
        oldUnit?.marks ?? [],
        newUnit?.marks ?? [],
        oldUnit?.citation,
        newUnit?.citation
      )

      let groupEnd = groupStart + 1
      while (groupEnd < unitCount) {
        const oldNext = equalOriginalUnits[groupEnd]
        const newNext = equalNewUnits[groupEnd]
        const nextSameInline = inlineEqual(
          oldNext?.marks ?? [],
          newNext?.marks ?? [],
          oldNext?.citation,
          newNext?.citation
        )
        const nextSignature = buildDiffSignature(
          oldNext?.marks ?? [],
          newNext?.marks ?? [],
          oldNext?.citation,
          newNext?.citation
        )

        if (nextSameInline !== sameInline) break
        if (!sameInline && nextSignature !== currentSignature) break
        groupEnd += 1
      }

      const oldGroup = equalOriginalUnits.slice(groupStart, groupEnd)
      const newGroup = equalNewUnits.slice(groupStart, groupEnd)

      if (sameInline) {
        pushRichSegment(result, {
          type: 'equal',
          text: concatUnitText(oldGroup),
          documentSize: documentSizeOf(oldGroup),
        })
      } else {
        pushRichSegment(result, {
          type: 'delete',
          text: concatUnitText(oldGroup),
          documentSize: documentSizeOf(oldGroup),
        })
        appendGroupedInsertUnits(result, newGroup)
      }

      groupStart = groupEnd
    }

    originalCursor += unitCount
    newCursor += unitCount
  }

  return result
}

/**
 * 比较两个 marks 数组是否完全相同（忽略顺序）
 */
function marksArrayEqual(a: MarkName[] | undefined, b: MarkName[] | undefined): boolean {
  if (!a && !b) return true
  const arrA = a ?? []
  const arrB = b ?? []
  if (arrA.length !== arrB.length) return false
  const sortedA = [...arrA].sort()
  const sortedB = [...arrB].sort()
  return sortedA.every((mark, index) => mark === sortedB[index])
}

// ==================== 公共 API ====================

/**
 * 计算带 marks 信息的 Rich Diff
 *
 * @param originalSpans - 旧内容的 spans（从文档抽取）
 * @param newSpans - 新内容的 spans（从 Markdown 解析）
 * @returns Rich Diff 结果
 *
 * @example
 * ```ts
 * const originalSpans = [{ text: 'Hello', marks: [] }]
 * const newSpans = [{ text: 'Hello', marks: ['bold'] }]
 *
 * const result = computeRichDiff(originalSpans, newSpans)
 * // result.segments 包含带 marks 信息的 diff 片段
 * ```
 */
export function computeRichDiff(originalSpans: TextSpan[], newSpans: TextSpan[]): RichDiffResult {
  // 中文说明：
  // CitationNode 的 NodeView 显示编号，Revision 中间表示使用 canonical token。这里使用
  // “可比较单元 diff”，不把任何视图文本当成文档身份：
  // - 普通文本仍按字符级比较，保持原有精度；
  // - citation 片段按稳定语义（citation attrs）作为原子单元比较；
  // - 真正应用到文档时仍保留各自原始显示文本。
  const originalUnits = buildComparableUnits(originalSpans)
  const newUnits = buildComparableUnits(newSpans)
  const { originalEncoded, newEncoded } = encodeComparableUnits(originalUnits, newUnits)
  const basicSegments = computeTextDiff(originalEncoded, newEncoded)
  const richSegments = buildRichSegmentsFromComparableUnits(basicSegments, originalUnits, newUnits)
  const finalStats = computeDiffStats(richSegments)

  return {
    segments: richSegments,
    stats: finalStats,
  }
}

/**
 * 从纯文本和新 Markdown spans 计算 Rich Diff
 *
 * 便捷函数，当旧内容没有格式信息时使用。
 *
 * @param originalText - 旧内容纯文本
 * @param newSpans - 新内容的 spans（从 Markdown 解析）
 * @returns Rich Diff 结果
 */
export function computeRichDiffFromText(
  originalText: string,
  newSpans: TextSpan[]
): RichDiffResult {
  // 将纯文本包装为无格式的 span
  const originalSpans: TextSpan[] = originalText ? [{ text: originalText, marks: [] }] : []

  return computeRichDiff(originalSpans, newSpans)
}

/**
 * 检查 Rich Diff 结果是否包含格式变化
 *
 * @param segments - Rich Diff 片段
 * @returns 是否有至少一个 insert 段带有 marks
 */
export function hasFormatChanges(segments: RichDiffSegment[]): boolean {
  return segments.some(seg => seg.type === 'insert' && seg.marks && seg.marks.length > 0)
}

// ==================== 导出 ====================

export default {
  computeRichDiff,
  computeRichDiffFromText,
  hasFormatChanges,
}
