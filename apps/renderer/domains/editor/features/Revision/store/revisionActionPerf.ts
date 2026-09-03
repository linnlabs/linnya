/**
 * revisionActionPerf.ts
 *
 * 修订接受/拒绝操作的低噪声性能采样。
 *
 * 中文说明：
 * - 这里只记录动作级汇总，不在滚动或投影热路径刷屏；
 * - 万行 pending 下，点击“接受 / 拒绝 / 全部接受 / 全部拒绝”卡顿时，
 *   可以通过 window.__REVISION_ACTION_PERF__ 判断瓶颈在投影、PM 命令、保存、IPC 还是重载文档。
 */

export type RevisionActionKind =
  | 'block-accept'
  | 'block-reject'
  | 'document-accept-all'
  | 'document-reject-all'

export type RevisionActionPath =
  | 'projected-command'
  | 'canonical-clear-only'
  | 'canonical-delete-root'
  | 'backend-apply-all'
  | 'backend-applied-renderer-failed'
  | 'backend-blocked'
  | 'failed'
  | 'noop'

export type RevisionActionStage =
  | 'resolve'
  | 'locate'
  | 'command'
  | 'state'
  | 'save'
  | 'backend'
  | 'backendIpc'
  | 'replaceDocument'
  | 'clearRuntime'
  | 'setDirty'

export interface RevisionActionPerfSample {
  id: number
  kind: RevisionActionKind
  path: RevisionActionPath
  blockId?: string
  documentId?: string
  pendingCountBefore?: number
  activeCountBefore?: number
  totalMs: number
  stages: Partial<Record<RevisionActionStage, number>>
  result: 'success' | 'skipped' | 'failed'
  error?: string
  timestamp: number
}

export interface RevisionActionPerfSession {
  measure: <T>(stage: RevisionActionStage, run: () => T) => T
  measureAsync: <T>(stage: RevisionActionStage, run: () => Promise<T>) => Promise<T>
  finish: (summary: {
    path: RevisionActionPath
    result: RevisionActionPerfSample['result']
    error?: unknown
  }) => RevisionActionPerfSample
}

export interface RevisionActionPerfApi {
  getLast: () => RevisionActionPerfSample | null
  getHistory: () => RevisionActionPerfSample[]
  clear: () => void
  setConsoleEnabled: (enabled: boolean) => void
  setVerbose: (enabled: boolean) => void
}

declare global {
  interface Window {
    __REVISION_ACTION_PERF__?: RevisionActionPerfApi
  }
}

const HISTORY_LIMIT = 40
const SLOW_ACTION_THRESHOLD_MS = 250
const LARGE_PENDING_THRESHOLD = 1000

let nextId = 1
let consoleEnabled = true
let verbose = false

const history: RevisionActionPerfSample[] = []

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function formatError(error: unknown): string | undefined {
  if (error == null) return undefined
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function shouldLog(sample: RevisionActionPerfSample): boolean {
  return consoleEnabled && (
    verbose ||
    sample.totalMs >= SLOW_ACTION_THRESHOLD_MS ||
    (sample.pendingCountBefore ?? 0) >= LARGE_PENDING_THRESHOLD ||
    sample.result === 'failed'
  )
}

function publish(sample: RevisionActionPerfSample): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installRevisionActionPerfApi()

  if (shouldLog(sample)) {
    console.info('[RevisionActionPerf] action summary', sample)
  }
}

export function createRevisionActionPerfSession(params: {
  kind: RevisionActionKind
  blockId?: string
  documentId?: string
  pendingCountBefore?: number
  activeCountBefore?: number
}): RevisionActionPerfSession {
  const id = nextId++
  const startedAt = nowMs()
  const stages: Partial<Record<RevisionActionStage, number>> = {}

  function addStage(stage: RevisionActionStage, durationMs: number): void {
    stages[stage] = roundMs((stages[stage] ?? 0) + Math.max(0, durationMs))
  }

  return {
    measure(stage, run) {
      const stageStartedAt = nowMs()
      try {
        return run()
      } finally {
        addStage(stage, nowMs() - stageStartedAt)
      }
    },
    async measureAsync(stage, run) {
      const stageStartedAt = nowMs()
      try {
        return await run()
      } finally {
        addStage(stage, nowMs() - stageStartedAt)
      }
    },
    finish(summary) {
      const sample: RevisionActionPerfSample = {
        id,
        kind: params.kind,
        path: summary.path,
        blockId: params.blockId,
        documentId: params.documentId,
        pendingCountBefore: params.pendingCountBefore,
        activeCountBefore: params.activeCountBefore,
        totalMs: roundMs(nowMs() - startedAt),
        stages,
        result: summary.result,
        error: formatError(summary.error),
        timestamp: Date.now(),
      }
      publish(sample)
      return sample
    },
  }
}

export function installRevisionActionPerfApi(): void {
  if (typeof window === 'undefined') return
  window.__REVISION_ACTION_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0
    },
    setConsoleEnabled: (enabled) => {
      consoleEnabled = enabled
    },
    setVerbose: (enabled) => {
      verbose = enabled
    },
  }
}

installRevisionActionPerfApi()
