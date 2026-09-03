/**
 * shellPendingProjectionPerf.ts
 *
 * Shell pending 投影桥的低噪声诊断。
 *
 * 中文说明：
 * - bridge 会跟随 render engine window 高频收到通知，不能逐帧输出日志；
 * - 这里默认只记录内存样本，异常或开启 renderVirtualizationDebugLogging 时节流输出；
 * - DevTools 中用 window.__SHELL_PENDING_PROJECTION_PERF__ 查看最近投影决策。
 */

import { getFlag } from '../../../../ui/services/editorFeatureFlags'

export type ShellPendingProjectionPerfReason =
  | 'bridge-start'
  | 'event-file-content-loaded'
  | 'event-pending-revisions-loaded'
  | 'engine-refresh'
  | 'snapshot-notify'
  | 'no-candidates'
  | 'projected'
  | 'failed'
  | 'throttled'
  | 'in-flight'
  | 'empty-window'
  | 'shell-disabled'
  | 'editor-unavailable'

export interface ShellPendingProjectionPerfSample {
  reason: ShellPendingProjectionPerfReason
  label?: string
  snapshotVersion?: number
  virtualizationEnabled?: boolean
  visibleCount?: number
  hydratedCount: number
  candidateCount: number
  projectedCount: number
  failedCount: number
  skippedActiveCount: number
  skippedNonPendingCount: number
  candidateBlockIds: string[]
  skippedActiveBlockIds: string[]
  skippedNonPendingBlockIds: string[]
  durationMs: number
  timestamp: number
}

export interface ShellPendingProjectionPerfApi {
  getLast: () => ShellPendingProjectionPerfSample | null
  getHistory: () => ShellPendingProjectionPerfSample[]
  clear: () => void
}

declare global {
  interface Window {
    __SHELL_PENDING_PROJECTION_PERF__?: ShellPendingProjectionPerfApi
  }
}

const HISTORY_LIMIT = 160
const THROTTLE_MS = 1200
const SLOW_PROJECTION_MS = 300

const history: ShellPendingProjectionPerfSample[] = []
let lastPrintedAt = 0

function installApi(): void {
  if (typeof window === 'undefined') return

  window.__SHELL_PENDING_PROJECTION_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0
    },
  }
}

function shouldPrint(sample: ShellPendingProjectionPerfSample): boolean {
  if (sample.reason === 'failed' || sample.failedCount > 0) return true
  if (sample.reason === 'projected' && sample.durationMs >= SLOW_PROJECTION_MS) return true
  return getFlag('renderVirtualizationDebugLogging')
}

export function publishShellPendingProjectionPerf(sample: ShellPendingProjectionPerfSample): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installApi()

  if (!shouldPrint(sample)) return

  const now = sample.timestamp
  if (now - lastPrintedAt < THROTTLE_MS) return
  lastPrintedAt = now
  console.info('[ShellPendingProjection] summary', sample)
}
