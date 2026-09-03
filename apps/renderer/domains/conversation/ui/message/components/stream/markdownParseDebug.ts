import type { ParsedNode } from 'stream-markdown-parser'

type RecordLike = Record<string, unknown>

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function isParsedNodeLike(value: unknown): value is ParsedNode {
  if (!isRecordLike(value)) return false
  return typeof value.type === 'string' && typeof value.raw === 'string'
}

function isTruthyEnvFlag(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

function isControlCharCode(code: number): boolean {
  return code === 0x08 || code === 0x09 || code === 0x0b || code === 0x0c || code === 0x0d
}

function findFirstControlCharIndex(content: string): number {
  for (let index = 0; index < content.length; index += 1) {
    if (isControlCharCode(content.charCodeAt(index))) return index
  }
  return -1
}

interface ParseDebugSummary {
  contentLength: number
  hasBmatrix: boolean
  controlCharCount: number
  typeCounts: Record<string, number>
  mathBlocks: Array<{ loading: boolean, rawHead: string, contentHead: string }>
  headings: Array<{ level: number, textHead: string, rawHead: string }>
}

function readNestedNodes(node: ParsedNode): ParsedNode[] {
  if (!isRecordLike(node)) return []
  const candidates = node.children ?? node.items ?? node.cells ?? node.rows
  return Array.isArray(candidates) ? candidates.filter(isParsedNodeLike) : []
}

function buildParseDebugSummary(content: string, nodes: ParsedNode[]): ParseDebugSummary {
  const typeCounts: Record<string, number> = {}
  const mathBlocks: ParseDebugSummary['mathBlocks'] = []
  const headings: ParseDebugSummary['headings'] = []

  const stack = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue

    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1

    if (node.type === 'math_block') {
      mathBlocks.push({
        loading: Boolean(node.loading),
        rawHead: String(node.raw ?? '').slice(0, 80),
        contentHead: String(node.content ?? '').slice(0, 80),
      })
    }

    if (node.type === 'heading') {
      const heading: RecordLike = isRecordLike(node) ? node : {}
      headings.push({
        level: typeof heading.level === 'number' ? heading.level : 1,
        textHead: String(heading.text ?? '').slice(0, 60),
        rawHead: String(heading.raw ?? '').slice(0, 80),
      })
    }

    stack.push(...readNestedNodes(node))
  }

  return {
    contentLength: content.length,
    hasBmatrix: content.includes('bmatrix'),
    controlCharCount: findControlCharHits(content, Number.POSITIVE_INFINITY).length,
    typeCounts,
    mathBlocks,
    headings,
  }
}

interface ControlCharHit {
  index: number
  code: number
  hex: string
  context: string
}

function findControlCharHits(content: string, maxHits: number): ControlCharHit[] {
  const hits: ControlCharHit[] = []
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (!isControlCharCode(code)) continue
    hits.push({
      index,
      code,
      hex: `0x${code.toString(16).padStart(2, '0')}`,
      context: content.slice(Math.max(0, index - 20), Math.min(content.length, index + 40)),
    })
    if (hits.length >= maxHits) break
  }
  return hits
}

interface BmatrixProbe {
  bmatrixIndex: number
  excerptAroundBmatrix: string
  dollarsCount: number
  firstDollarIndex: number
  excerptAroundFirstDollar: string
  beginBackslashRun: number
  beginPrefixExcerpt: string
}

function probeBmatrix(content: string): BmatrixProbe | null {
  const bmatrixIndex = content.indexOf('bmatrix')
  if (bmatrixIndex < 0) return null

  const firstDollarIndex = content.indexOf('$$')
  const beginMatch = /(\\+)begin\{bmatrix\}/.exec(content)
  const beginPrefixIndex = beginMatch?.index ?? -1

  return {
    bmatrixIndex,
    excerptAroundBmatrix: content.slice(
      Math.max(0, bmatrixIndex - 80),
      Math.min(content.length, bmatrixIndex + 160),
    ),
    dollarsCount: (content.match(/\$\$/g) ?? []).length,
    firstDollarIndex,
    excerptAroundFirstDollar: firstDollarIndex >= 0
      ? content.slice(Math.max(0, firstDollarIndex - 40), Math.min(content.length, firstDollarIndex + 120))
      : '',
    beginBackslashRun: beginMatch?.[1]?.length ?? 0,
    beginPrefixExcerpt: beginPrefixIndex >= 0
      ? content.slice(Math.max(0, beginPrefixIndex - 30), Math.min(content.length, beginPrefixIndex + 60))
      : '',
  }
}

export interface MarkdownParseDebug {
  shouldParseImmediately: (content: string) => boolean
  inspect: (content: string, nodes: ParsedNode[], isStreaming: boolean) => void
}

/**
 * 公式解析探针默认关闭，只在显式环境开关下参与解析调度和日志。
 * 状态封装在实例内，避免多个消息渲染器共享去重签名。
 */
export function createMarkdownParseDebug(envFlag: unknown): MarkdownParseDebug {
  const enabled = isTruthyEnvFlag(envFlag)
  let lastDebugSignature = ''
  let lastWarnSignature = ''

  const hasHighSignal = (content: string): boolean => (
    content.includes('bmatrix') || findFirstControlCharIndex(content) >= 0
  )

  return {
    shouldParseImmediately(content) {
      return enabled && hasHighSignal(content)
    },
    inspect(content, nodes, isStreaming) {
      if (!enabled || !hasHighSignal(content)) return

      const summary = buildParseDebugSummary(content, nodes)
      const signature = JSON.stringify({
        contentLength: summary.contentLength,
        hasBmatrix: summary.hasBmatrix,
        controlCharCount: summary.controlCharCount,
        typeCounts: summary.typeCounts,
        mathBlocks: summary.mathBlocks.map(item => ({ loading: item.loading, rawHead: item.rawHead })),
        headings: summary.headings.map(item => ({ level: item.level, textHead: item.textHead })),
      })

      if (signature !== lastDebugSignature) {
        lastDebugSignature = signature
        console.groupCollapsed('[ConversationMarkdownRenderer][debug] parse summary')
        console.debug('isStreaming:', isStreaming)
        console.debug('contentLength:', summary.contentLength)
        console.debug('controlCharCount:', summary.controlCharCount, 'hasBmatrix:', summary.hasBmatrix)
        console.debug('typeCounts:', summary.typeCounts)
        console.debug('mathBlocks:', summary.mathBlocks)
        console.debug('headings:', summary.headings)

        const bmatrixIndex = content.indexOf('bmatrix')
        if (bmatrixIndex >= 0) {
          console.debug(
            'excerptAroundBmatrix:',
            content.slice(Math.max(0, bmatrixIndex - 80), Math.min(content.length, bmatrixIndex + 160)),
          )
        }
        const controlCharIndex = findFirstControlCharIndex(content)
        if (controlCharIndex >= 0) {
          console.debug(
            'excerptAroundControlChar:',
            content.slice(Math.max(0, controlCharIndex - 40), Math.min(content.length, controlCharIndex + 80)),
          )
        }
        console.groupEnd()
      }

      const hasMathBlock = (summary.typeCounts.math_block ?? 0) > 0
      if (summary.controlCharCount === 0 && (!summary.hasBmatrix || hasMathBlock)) return

      const warnPayload = {
        isStreaming,
        contentLength: summary.contentLength,
        hasBmatrix: summary.hasBmatrix,
        controlCharCount: summary.controlCharCount,
        controlCharHits: findControlCharHits(content, 6),
        bmatrixProbe: summary.hasBmatrix ? probeBmatrix(content) : null,
        typeCounts: summary.typeCounts,
        mathBlocks: summary.mathBlocks,
        headings: summary.headings,
      }
      const warnSignature = JSON.stringify({
        contentLength: warnPayload.contentLength,
        hasBmatrix: warnPayload.hasBmatrix,
        controlCharCount: warnPayload.controlCharCount,
        typeCounts: warnPayload.typeCounts,
        controlCharHit0: warnPayload.controlCharHits[0]?.hex,
        mathBlockCount: warnPayload.typeCounts.math_block ?? 0,
      })
      if (warnSignature !== lastWarnSignature) {
        lastWarnSignature = warnSignature
        console.warn('[ConversationMarkdownRenderer][debug][WARN] math parse drift candidate', warnPayload)
      }
    },
  }
}
