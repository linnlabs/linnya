/**
 * decorationSetRuntimePerf.ts
 *
 * ProseMirror DecorationSet 运行时探针。
 *
 * 中文说明：
 * - 大文档卡顿不只来自 Vue NodeView，也可能来自 plugin decorations 的构建与返回；
 * - 这里按 source 记录 decoration 数量、耗时和访问节点数量；
 * - 样本只保存在内存 ring buffer 中，避免观测代码制造新的滚动/输入卡顿。
 */

export type DecorationSetPerfSource =
  | 'render-virtualization'
  | 'placeholder'
  | 'find-replace'
  | 'citation'
  | 'autocomplete'
  | 'table'
  | 'unknown'

export interface DecorationSetPerfSample {
  source: DecorationSetPerfSource
  decorationCount: number
  durationMs: number
  visitedNodeCount?: number
  trigger?: string
  timestamp: number
}

export interface DecorationSetPerfSummary {
  source: DecorationSetPerfSource
  callCount: number
  totalDecorationCount: number
  lastDecorationCount: number
  totalDurationMs: number
  maxDurationMs: number
}

export interface DecorationSetPerfApi {
  getLast: () => DecorationSetPerfSample | null
  getHistory: () => DecorationSetPerfSample[]
  getSummary: () => DecorationSetPerfSummary[]
  clear: () => void
}

declare global {
  interface Window {
    __DECORATION_SET_PERF__?: DecorationSetPerfApi
  }
}

const HISTORY_LIMIT = 160
const history: DecorationSetPerfSample[] = []

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10
}

function buildSummary(): DecorationSetPerfSummary[] {
  const bySource = new Map<DecorationSetPerfSource, DecorationSetPerfSummary>()

  for (const sample of history) {
    const current = bySource.get(sample.source) ?? {
      source: sample.source,
      callCount: 0,
      totalDecorationCount: 0,
      lastDecorationCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    }

    current.callCount += 1
    current.totalDecorationCount += sample.decorationCount
    current.lastDecorationCount = sample.decorationCount
    current.totalDurationMs = roundMs(current.totalDurationMs + sample.durationMs)
    current.maxDurationMs = Math.max(current.maxDurationMs, sample.durationMs)
    bySource.set(sample.source, current)
  }

  return Array.from(bySource.values()).sort((left, right) => {
    return right.totalDurationMs - left.totalDurationMs
  })
}

function installDecorationSetPerfApi(): void {
  if (typeof window === 'undefined') return

  window.__DECORATION_SET_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    getSummary: buildSummary,
    clear: () => {
      history.length = 0
    },
  }
}

export function recordDecorationSetPerfSample(params: {
  source: DecorationSetPerfSource
  decorationCount: number
  startedAt: number
  visitedNodeCount?: number
  trigger?: string
}): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  history.push({
    source: params.source,
    decorationCount: Math.max(0, Math.floor(params.decorationCount)),
    durationMs: roundMs(Math.max(0, now - params.startedAt)),
    visitedNodeCount:
      typeof params.visitedNodeCount === 'number'
        ? Math.max(0, Math.floor(params.visitedNodeCount))
        : undefined,
    trigger: params.trigger,
    timestamp: Date.now(),
  })

  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installDecorationSetPerfApi()
}

installDecorationSetPerfApi()
