/**
 * editorMemoryPerf.ts
 *
 * 编辑器内存采样服务。
 *
 * 中文说明：
 * - 只采样 Chrome/Electron 暴露的 JS heap 指标，不主动遍历 DOM 或文档对象；
 * - 默认不刷屏，只有超过预算时按节流输出一次 warn；
 * - 通过 window.__EDITOR_MEMORY_PERF__ 手动查看历史，方便压测 10000 pending 场景。
 */

export interface EditorMemorySample {
  label: string
  usedJSHeapMB: number | null
  totalJSHeapMB: number | null
  jsHeapLimitMB: number | null
  timestamp: number
}

export interface EditorMemoryPerfApi {
  sample: (label?: string) => EditorMemorySample
  getLast: () => EditorMemorySample | null
  getHistory: () => EditorMemorySample[]
  clear: () => void
  start: (intervalMs?: number) => void
  stop: () => void
}

interface PerformanceMemoryInfo {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

interface PerformanceWithOptionalMemory extends Performance {
  memory?: PerformanceMemoryInfo
}

declare global {
  interface Window {
    __EDITOR_MEMORY_PERF__?: EditorMemoryPerfApi
  }
}

const HISTORY_LIMIT = 80
const DEFAULT_INTERVAL_MS = 5000
const MEMORY_BUDGET_MB = 600
const WARN_THROTTLE_MS = 30000

const history: EditorMemorySample[] = []
let monitorTimer: number | null = null
let lastWarnAt = 0

function roundMB(bytes: number | null): number | null {
  if (bytes === null) return null
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function readPerformanceMemory(): PerformanceMemoryInfo | null {
  if (typeof performance === 'undefined') return null
  const perf = performance as PerformanceWithOptionalMemory
  return perf.memory ?? null
}

function publishSample(sample: EditorMemorySample): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)

  const now = Date.now()
  if (
    sample.usedJSHeapMB !== null &&
    sample.usedJSHeapMB >= MEMORY_BUDGET_MB &&
    now - lastWarnAt >= WARN_THROTTLE_MS
  ) {
    lastWarnAt = now
    console.warn('[EditorMemoryPerf] JS heap 超过预算', sample)
  }
}

export function sampleEditorMemory(label = 'manual'): EditorMemorySample {
  const memory = readPerformanceMemory()
  const sample: EditorMemorySample = {
    label,
    usedJSHeapMB: roundMB(memory?.usedJSHeapSize ?? null),
    totalJSHeapMB: roundMB(memory?.totalJSHeapSize ?? null),
    jsHeapLimitMB: roundMB(memory?.jsHeapSizeLimit ?? null),
    timestamp: Date.now(),
  }
  publishSample(sample)
  return sample
}

export function getLastEditorMemorySample(): EditorMemorySample | null {
  return history[history.length - 1] ?? null
}

export function getEditorMemoryHistory(): EditorMemorySample[] {
  return [...history]
}

export function clearEditorMemoryHistory(): void {
  history.length = 0
  lastWarnAt = 0
}

export function startEditorMemoryMonitor(intervalMs = DEFAULT_INTERVAL_MS): void {
  stopEditorMemoryMonitor()
  const safeInterval = Math.max(1000, Math.floor(intervalMs))
  monitorTimer = window.setInterval(() => {
    sampleEditorMemory('interval')
  }, safeInterval)
}

export function stopEditorMemoryMonitor(): void {
  if (monitorTimer === null) return
  window.clearInterval(monitorTimer)
  monitorTimer = null
}

if (typeof window !== 'undefined') {
  window.__EDITOR_MEMORY_PERF__ = {
    sample: sampleEditorMemory,
    getLast: getLastEditorMemorySample,
    getHistory: getEditorMemoryHistory,
    clear: clearEditorMemoryHistory,
    start: startEditorMemoryMonitor,
    stop: stopEditorMemoryMonitor,
  }
}
