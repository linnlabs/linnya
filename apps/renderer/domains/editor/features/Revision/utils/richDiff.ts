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
  /** 该片段在“可比较单元”层面的长度；对 inlineAtom 这类原子节点应为 1 */
  unitCount?: number
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

/**
 * 构建字符位置到 marks 的映射表
 *
 * @param spans - TextSpan 数组
 * @returns 每个字符位置对应的 marks 数组
 */
function buildCharToMarksMap(spans: TextSpan[]): MarkName[][] {
  const charToMarks: MarkName[][] = []

  for (const span of spans) {
    for (let i = 0; i < span.text.length; i++) {
      charToMarks.push([...span.marks])
    }
  }

  return charToMarks
}

/**
 * 构建字符位置到 citation 元数据的映射表。
 */
function buildCharToCitationMap(spans: TextSpan[]): Array<CitationInlineMeta | undefined> {
  const charToCitation: Array<CitationInlineMeta | undefined> = []

  for (const span of spans) {
    for (let i = 0; i < span.text.length; i++) {
      charToCitation.push(span.citation)
    }
  }

  return charToCitation
}

/**
 * 收集指定范围内所有字符的 marks 并集
 *
 * @param charToMarks - 字符位置到 marks 的映射
 * @param start - 起始位置
 * @param length - 长度
 * @returns marks 并集
 */
function collectMarksInRange(charToMarks: MarkName[][], start: number, length: number): MarkName[] {
  const marksSet = new Set<MarkName>()

  for (let i = 0; i < length; i++) {
    const pos = start + i
    const marks = charToMarks[pos]
    if (marks) {
      marks.forEach(m => marksSet.add(m))
    }
  }

  return Array.from(marksSet)
}

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
    last.unitCount = (last.unitCount ?? 0) + (segment.unitCount ?? 0)
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
      unitCount: end - start,
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
        unitCount: deletedUnits.length,
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
          unitCount: oldGroup.length,
        })
      } else {
        pushRichSegment(result, {
          type: 'delete',
          text: concatUnitText(oldGroup),
          unitCount: oldGroup.length,
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
 * 将基础 DiffSegment 转换为 RichDiffSegment
 * 为 insert 段附加 marks 信息
 *
 * @param segments - 基础 diff 片段
 * @param newCharToMarks - 新文本的字符位置到 marks 映射
 * @returns Rich Diff 片段序列
 */
function attachMarksToSegments(
  segments: DiffSegment[],
  newCharToMarks: MarkName[][],
  newCharToCitation: Array<CitationInlineMeta | undefined>
): RichDiffSegment[] {
  let newTextCursor = 0
  const result: RichDiffSegment[] = []

  segments.forEach(seg => {
    if (seg.type === 'insert') {
      const text = seg.text
      let cursor = 0

      while (cursor < text.length) {
        // 获取当前字符的 marks
        const currentMarks = newCharToMarks[newTextCursor + cursor] ?? []
        const currentCitation = newCharToCitation[newTextCursor + cursor]

        // 寻找具有相同 marks + citation 的连续子串
        let end = cursor + 1
        while (end < text.length) {
          const nextMarks = newCharToMarks[newTextCursor + end] ?? []
          const nextCitation = newCharToCitation[newTextCursor + end]
          if (
            !marksArrayEqual(currentMarks, nextMarks) ||
            !citationEqual(currentCitation, nextCitation)
          ) {
            break
          }
          end++
        }

        const subText = text.slice(cursor, end)
        result.push({
          type: 'insert',
          text: subText,
          marks: currentMarks.length > 0 ? currentMarks : undefined,
          citation: currentCitation,
        })

        cursor = end
      }

      newTextCursor += text.length
    } else if (seg.type === 'equal') {
      // equal 段同时推进新文本游标
      newTextCursor += seg.text.length

      result.push({
        type: 'equal',
        text: seg.text,
      })
    } else {
      // delete 段不移动新文本游标
      result.push({
        type: 'delete',
        text: seg.text,
      })
    }
  })

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

/**
 * 当纯文本完全相同时，仅根据 marks 变化生成 RichDiff 片段
 *
 * 典型场景：AI 只新增/修改了格式（例如 Hello -> **Hello**），
 * 此时 computeTextDiff 认为“文本相等”，但我们希望通过 delete+insert
 * 的方式让 Revision 展示出「格式变化」。
 */
function computeFormatOnlySegments(
  originalText: string,
  newText: string,
  originalCharToMarks: MarkName[][],
  newCharToMarks: MarkName[][],
  originalCharToCitation: Array<CitationInlineMeta | undefined>,
  newCharToCitation: Array<CitationInlineMeta | undefined>
): RichDiffSegment[] | null {
  // 仅在纯文本长度一致且完全相等时才走格式差异逻辑
  if (originalText !== newText || originalCharToMarks.length !== newCharToMarks.length) {
    return null
  }

  const length = originalText.length

  // 找出所有「marks 有差异」的连续区间
  interface DiffRange {
    start: number
    end: number
  }

  const ranges: DiffRange[] = []
  let inDiff = false
  let rangeStart = 0
  let currentDiffSignature = ''

  for (let i = 0; i < length; i++) {
    const oldMarks = originalCharToMarks[i] ?? []
    const newMarks = newCharToMarks[i] ?? []
    const oldCitation = originalCharToCitation[i]
    const newCitation = newCharToCitation[i]
    const same = inlineEqual(oldMarks, newMarks, oldCitation, newCitation)
    const signature = buildDiffSignature(oldMarks, newMarks, oldCitation, newCitation)

    if (!same && !inDiff) {
      inDiff = true
      rangeStart = i
      currentDiffSignature = signature
    } else if (same && inDiff) {
      ranges.push({ start: rangeStart, end: i })
      inDiff = false
      currentDiffSignature = ''
    } else if (!same && inDiff && currentDiffSignature !== signature) {
      ranges.push({ start: rangeStart, end: i })
      rangeStart = i
      currentDiffSignature = signature
    }
  }

  if (inDiff) {
    ranges.push({ start: rangeStart, end: length })
  }

  // 如果没有任何 marks 差异，则返回 null
  if (ranges.length === 0) {
    return null
  }

  const segments: RichDiffSegment[] = []
  let cursor = 0

  for (const range of ranges) {
    const { start, end } = range

    // 先推入中间的 equal 段
    if (start > cursor) {
      segments.push({
        type: 'equal',
        text: originalText.slice(cursor, start),
      })
    }

    const lengthInRange = end - start

    // 再推入 delete 段（旧格式）
    if (lengthInRange > 0) {
      segments.push({
        type: 'delete',
        text: originalText.slice(start, end),
      })
    }

    // 最后推入 insert 段（新格式，附带 marks）
    if (lengthInRange > 0) {
      const marks = collectMarksInRange(newCharToMarks, start, lengthInRange)
      const citation = newCharToCitation[start]
      segments.push({
        type: 'insert',
        text: newText.slice(start, end),
        marks: marks.length > 0 ? marks : undefined,
        citation,
      })
    }

    cursor = end
  }

  // 末尾残余的 equal 段
  if (cursor < length) {
    segments.push({
      type: 'equal',
      text: originalText.slice(cursor),
    })
  }

  return segments
}

/**
 * 在存在文本改动的情况下，拆分 equal 段以捕获仅格式变化的区间
 * 目的：当文本 diff 已出现 insert/delete 时，原有 format-only 分支不会触发，
 *       这里对 equal 段按字符 marks 差异再细分，生成 delete+insert（带 marks）。
 */
function expandEqualSegmentsForFormatChanges(
  segments: RichDiffSegment[],
  originalCharToMarks: MarkName[][],
  newCharToMarks: MarkName[][],
  originalCharToCitation: Array<CitationInlineMeta | undefined>,
  newCharToCitation: Array<CitationInlineMeta | undefined>
): RichDiffSegment[] {
  const expanded: RichDiffSegment[] = []
  let originalPos = 0
  let newPos = 0

  const pushSegment = (seg: RichDiffSegment) => {
    // 合并相邻 equal 以保持输出紧凑
    const last = expanded[expanded.length - 1]
    if (last && last.type === 'equal' && seg.type === 'equal') {
      last.text += seg.text
      return
    }
    expanded.push(seg)
  }

  for (const seg of segments) {
    if (seg.type === 'equal') {
      const text = seg.text
      let cursor = 0

      while (cursor < text.length) {
        const currentOldMarks = originalCharToMarks[originalPos + cursor] ?? []
        const currentNewMarks = newCharToMarks[newPos + cursor] ?? []
        const currentOldCitation = originalCharToCitation[originalPos + cursor]
        const currentNewCitation = newCharToCitation[newPos + cursor]
        const sameInline = inlineEqual(
          currentOldMarks,
          currentNewMarks,
          currentOldCitation,
          currentNewCitation
        )
        const currentDiffSignature = buildDiffSignature(
          currentOldMarks,
          currentNewMarks,
          currentOldCitation,
          currentNewCitation
        )

        let end = cursor
        while (end < text.length) {
          const oldMarks = originalCharToMarks[originalPos + end] ?? []
          const newMarks = newCharToMarks[newPos + end] ?? []
          const oldCitation = originalCharToCitation[originalPos + end]
          const newCitation = newCharToCitation[newPos + end]
          const nextSameInline = inlineEqual(oldMarks, newMarks, oldCitation, newCitation)
          const nextDiffSignature = buildDiffSignature(oldMarks, newMarks, oldCitation, newCitation)
          if (nextSameInline !== sameInline) {
            break
          }
          if (!sameInline && nextDiffSignature !== currentDiffSignature) {
            break
          }
          end++
        }

        const slice = text.slice(cursor, end)
        if (sameInline) {
          pushSegment({ type: 'equal', text: slice })
        } else {
          // 先删除旧格式，再插入新格式
          pushSegment({ type: 'delete', text: slice })

          const marks = collectMarksInRange(newCharToMarks, newPos + cursor, slice.length)
          const citation = newCharToCitation[newPos + cursor]
          pushSegment({
            type: 'insert',
            text: slice,
            marks: marks.length > 0 ? marks : undefined,
            citation,
          })
        }

        cursor = end
        originalPos += slice.length
        newPos += slice.length
      }
    } else if (seg.type === 'delete') {
      pushSegment(seg)
      originalPos += seg.text.length
    } else if (seg.type === 'insert') {
      pushSegment(seg)
      newPos += seg.text.length
    }
  }

  return expanded
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
  const finalStats = computeDiffStats(richSegments as unknown as DiffSegment[])

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
