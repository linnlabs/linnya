/**
 * rootBlockNodeViewRuntimePerf.ts
 *
 * RootBlock NodeView 运行时实例探针。
 *
 * 中文说明：
 * - `editorOpenPerf` 只能看到首开累计创建耗时；
 * - 大文档虚拟化接下来要判断的是“当前屏幕还活着多少 Vue rootBlock 壳”；
 * - 这里只写内存快照，不参与业务分支，避免观测代码反向影响渲染策略。
 */

export type RootBlockNodeViewRuntimeKind = 'vue' | 'dom' | 'shell' | 'placeholder'

export interface RootBlockNodeViewRuntimeEvent {
  kind: RootBlockNodeViewRuntimeKind
  blockId: string
  phase: 'mount' | 'unmount'
  activeCount: number
  timestamp: number
}

export interface RootBlockNodeViewRuntimeSnapshot {
  activeTotal: number
  activeByKind: Record<RootBlockNodeViewRuntimeKind, number>
  mountedTotalByKind: Record<RootBlockNodeViewRuntimeKind, number>
  unmountedTotalByKind: Record<RootBlockNodeViewRuntimeKind, number>
  sampleBlockIdsByKind: Record<RootBlockNodeViewRuntimeKind, string[]>
  timestamp: number
}

export interface RootBlockNodeViewRuntimePerfApi {
  getSnapshot: () => RootBlockNodeViewRuntimeSnapshot
  getHistory: () => RootBlockNodeViewRuntimeEvent[]
  clear: () => void
}

declare global {
  interface Window {
    __VUE_NODEVIEW_PERF__?: RootBlockNodeViewRuntimePerfApi
  }
}

const HISTORY_LIMIT = 120
const SAMPLE_BLOCK_ID_LIMIT = 12
const kinds: readonly RootBlockNodeViewRuntimeKind[] = ['vue', 'dom', 'shell', 'placeholder']

const activeBlockCountsByKind = new Map<RootBlockNodeViewRuntimeKind, Map<string, number>>()
const mountedTotalByKind = new Map<RootBlockNodeViewRuntimeKind, number>()
const unmountedTotalByKind = new Map<RootBlockNodeViewRuntimeKind, number>()
const history: RootBlockNodeViewRuntimeEvent[] = []

function ensureKindMap(kind: RootBlockNodeViewRuntimeKind): Map<string, number> {
  let map = activeBlockCountsByKind.get(kind)
  if (!map) {
    map = new Map<string, number>()
    activeBlockCountsByKind.set(kind, map)
  }
  return map
}

function incrementCounter(
  counters: Map<RootBlockNodeViewRuntimeKind, number>,
  kind: RootBlockNodeViewRuntimeKind
): void {
  counters.set(kind, (counters.get(kind) ?? 0) + 1)
}

function getCounterSnapshot(
  counters: Map<RootBlockNodeViewRuntimeKind, number>
): Record<RootBlockNodeViewRuntimeKind, number> {
  return {
    vue: counters.get('vue') ?? 0,
    dom: counters.get('dom') ?? 0,
    shell: counters.get('shell') ?? 0,
    placeholder: counters.get('placeholder') ?? 0,
  }
}

function getActiveByKind(): Record<RootBlockNodeViewRuntimeKind, number> {
  return {
    vue: getKindActiveCount('vue'),
    dom: getKindActiveCount('dom'),
    shell: getKindActiveCount('shell'),
    placeholder: getKindActiveCount('placeholder'),
  }
}

function getSampleBlockIdsByKind(): Record<RootBlockNodeViewRuntimeKind, string[]> {
  return {
    vue: Array.from(activeBlockCountsByKind.get('vue')?.keys() ?? []).slice(0, SAMPLE_BLOCK_ID_LIMIT),
    dom: Array.from(activeBlockCountsByKind.get('dom')?.keys() ?? []).slice(0, SAMPLE_BLOCK_ID_LIMIT),
    shell: Array.from(activeBlockCountsByKind.get('shell')?.keys() ?? []).slice(0, SAMPLE_BLOCK_ID_LIMIT),
    placeholder: Array.from(activeBlockCountsByKind.get('placeholder')?.keys() ?? []).slice(0, SAMPLE_BLOCK_ID_LIMIT),
  }
}

function getKindActiveCount(kind: RootBlockNodeViewRuntimeKind): number {
  let total = 0
  activeBlockCountsByKind.get(kind)?.forEach((count) => {
    total += count
  })
  return total
}

function getActiveTotal(): number {
  return kinds.reduce((total, kind) => total + getKindActiveCount(kind), 0)
}

function buildSnapshot(): RootBlockNodeViewRuntimeSnapshot {
  return {
    activeTotal: getActiveTotal(),
    activeByKind: getActiveByKind(),
    mountedTotalByKind: getCounterSnapshot(mountedTotalByKind),
    unmountedTotalByKind: getCounterSnapshot(unmountedTotalByKind),
    sampleBlockIdsByKind: getSampleBlockIdsByKind(),
    timestamp: Date.now(),
  }
}

function publishEvent(event: RootBlockNodeViewRuntimeEvent): void {
  history.push(event)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installRootBlockNodeViewRuntimePerfApi()
}

export function installRootBlockNodeViewRuntimePerfApi(): void {
  if (typeof window === 'undefined') return

  window.__VUE_NODEVIEW_PERF__ = {
    getSnapshot: buildSnapshot,
    getHistory: () => [...history],
    clear: () => {
      activeBlockCountsByKind.clear()
      mountedTotalByKind.clear()
      unmountedTotalByKind.clear()
      history.length = 0
    },
  }
}

export function recordRootBlockNodeViewMounted(params: {
  kind: RootBlockNodeViewRuntimeKind
  blockId: string
}): void {
  const blockId = params.blockId.trim()
  if (!blockId) return

  const activeMap = ensureKindMap(params.kind)
  activeMap.set(blockId, (activeMap.get(blockId) ?? 0) + 1)
  incrementCounter(mountedTotalByKind, params.kind)
  publishEvent({
    kind: params.kind,
    blockId,
    phase: 'mount',
    activeCount: getKindActiveCount(params.kind),
    timestamp: Date.now(),
  })
}

export function recordRootBlockNodeViewUnmounted(params: {
  kind: RootBlockNodeViewRuntimeKind
  blockId: string
}): void {
  const blockId = params.blockId.trim()
  if (!blockId) return

  const activeMap = ensureKindMap(params.kind)
  const nextCount = Math.max(0, (activeMap.get(blockId) ?? 0) - 1)
  if (nextCount === 0) activeMap.delete(blockId)
  else activeMap.set(blockId, nextCount)
  incrementCounter(unmountedTotalByKind, params.kind)
  publishEvent({
    kind: params.kind,
    blockId,
    phase: 'unmount',
    activeCount: getKindActiveCount(params.kind),
    timestamp: Date.now(),
  })
}

installRootBlockNodeViewRuntimePerfApi()
