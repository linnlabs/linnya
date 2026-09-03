/**
 * shellRevisionHeaderPerf.ts
 *
 * Shell revision header 的低噪声诊断。
 *
 * 中文说明：
 * - header 同步跟随滚动窗口，正常情况下会高频执行；
 * - 所有样本默认写入内存，只有异常或开启 renderVirtualizationDebugLogging 时节流输出；
 * - DevTools 中用 window.__SHELL_REVISION_HEADER_PERF__ 查看完整历史。
 */

import { getFlag } from '../../../../ui/services/editorFeatureFlags'

export type ShellRevisionHeaderPerfKind = 'early-return' | 'sync'

export interface ShellRevisionHeaderPerfSample {
  kind: ShellRevisionHeaderPerfKind
  reason: string
  snapshotVersion: number
  snapshotReason: string
  hydratedCount: number
  canonicalCount: number
  activeCount: number
  outerMissCount: number
  sessionMissCount: number
  slotMissCount: number
  renderedCount: number
  outerMissBlockIds: string[]
  sessionMissBlockIds: string[]
  slotMissBlockIds: string[]
  renderedBlockIds: string[]
  layoutChanged: boolean
  durationMs: number
  timestamp: number
}

export interface ShellRevisionHeaderPerfApi {
  getLast: () => ShellRevisionHeaderPerfSample | null
  getHistory: () => ShellRevisionHeaderPerfSample[]
  clear: () => void
}

declare global {
  interface Window {
    __SHELL_REVISION_HEADER_PERF__?: ShellRevisionHeaderPerfApi
  }
}

const HISTORY_LIMIT = 160
const THROTTLE_MS = 1200
const SLOW_SYNC_MS = 24

const history: ShellRevisionHeaderPerfSample[] = []
let lastPrintedAt = 0

function shouldPrint(sample: ShellRevisionHeaderPerfSample): boolean {
  if (!getFlag('renderVirtualizationDebugLogging')) return false
  return (
    sample.durationMs >= SLOW_SYNC_MS ||
    sample.outerMissCount > 0 ||
    sample.slotMissCount > 0
  )
}

function installApi(): void {
  if (typeof window === 'undefined') return

  window.__SHELL_REVISION_HEADER_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0
    },
  }
}

export function publishShellRevisionHeaderPerf(sample: ShellRevisionHeaderPerfSample): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installApi()

  if (!shouldPrint(sample)) return

  const now = sample.timestamp
  if (now - lastPrintedAt < THROTTLE_MS) return
  lastPrintedAt = now

  const method = sample.kind === 'early-return' || sample.slotMissCount > 0 ? console.warn : console.info
  method('[ShellRevisionHeader] sync summary', sample)
}
