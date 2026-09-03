/**
 * blockChromeRuntimePerf.ts
 *
 * BlockChrome 运行时探针。
 *
 * 中文说明：
 * - 大文档卡顿里最需要持续观测的是“挂了多少 chrome”和“chrome 带来了多少 editor 监听器”；
 * - 这里不做 console 输出，只提供 DevTools 可读的内存快照；
 * - 后续中央化 BlockChromeHost 时，继续复用同一组指标做前后对照。
 */

export type EditorListenerPerfEventName = 'update' | 'selectionUpdate' | 'transaction'
export type BlockChromeLifecyclePhase = 'mount' | 'unmount'

export interface BlockChromeLifecyclePerfSample {
  blockId: string
  phase: BlockChromeLifecyclePhase
  setupToMountedMs?: number
  activeCount: number
  timestamp: number
}

export interface BlockChromeLifecyclePerfApi {
  getLast: () => BlockChromeLifecyclePerfSample | null
  getHistory: () => BlockChromeLifecyclePerfSample[]
  getActiveCount: () => number
  clear: () => void
}

export interface BlockActivationPerfSnapshot {
  activeCount: number
  byReason: Record<string, number>
  blockIds: string[]
  timestamp: number
}

export interface BlockActivationPerfApi {
  getSnapshot: () => BlockActivationPerfSnapshot
  getHistory: () => BlockActivationPerfSnapshot[]
  clear: () => void
}

export interface EditorListenerPerfSnapshot {
  total: number
  byEvent: Record<EditorListenerPerfEventName, number>
  byOwner: Record<string, number>
  timestamp: number
}

export interface EditorListenerPerfApi {
  getSnapshot: () => EditorListenerPerfSnapshot
  getHistory: () => EditorListenerPerfSnapshot[]
  clear: () => void
}

declare global {
  interface Window {
    __BLOCK_CHROME_LIFECYCLE_PERF__?: BlockChromeLifecyclePerfApi
    __BLOCK_ACTIVATION_PERF__?: BlockActivationPerfApi
    __EDITOR_LISTENER_PERF__?: EditorListenerPerfApi
  }
}

const HISTORY_LIMIT = 120
const ACTIVE_BLOCK_ID_LIMIT = 24

const lifecycleHistory: BlockChromeLifecyclePerfSample[] = []
const activeChromeBlockIds = new Set<string>()

const activeReasonsByBlockId = new Map<string, readonly string[]>()
const activationHistory: BlockActivationPerfSnapshot[] = []

const listenerCountsByKey = new Map<string, number>()
const listenerHistory: EditorListenerPerfSnapshot[] = []

function clampHistory<T>(history: T[]): void {
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
}

function getListenerKey(owner: string, eventName: EditorListenerPerfEventName): string {
  return `${owner}:${eventName}`
}

function splitListenerKey(key: string): {
  owner: string
  eventName: EditorListenerPerfEventName
} | null {
  const [owner, eventName] = key.split(':')
  if (
    !owner ||
    (eventName !== 'update' && eventName !== 'selectionUpdate' && eventName !== 'transaction')
  ) {
    return null
  }
  return { owner, eventName }
}

function buildActivationSnapshot(): BlockActivationPerfSnapshot {
  const byReason: Record<string, number> = {}
  const blockIds: string[] = []

  activeReasonsByBlockId.forEach((reasons, blockId) => {
    if (blockIds.length < ACTIVE_BLOCK_ID_LIMIT) blockIds.push(blockId)
    reasons.forEach((reason) => {
      byReason[reason] = (byReason[reason] ?? 0) + 1
    })
  })

  return {
    activeCount: activeReasonsByBlockId.size,
    byReason,
    blockIds,
    timestamp: Date.now(),
  }
}

function buildListenerSnapshot(): EditorListenerPerfSnapshot {
  const byEvent: Record<EditorListenerPerfEventName, number> = {
    update: 0,
    selectionUpdate: 0,
    transaction: 0,
  }
  const byOwner: Record<string, number> = {}

  listenerCountsByKey.forEach((count, key) => {
    const parsed = splitListenerKey(key)
    if (!parsed) return
    byEvent[parsed.eventName] += count
    byOwner[parsed.owner] = (byOwner[parsed.owner] ?? 0) + count
  })

  return {
    total: byEvent.update + byEvent.selectionUpdate + byEvent.transaction,
    byEvent,
    byOwner,
    timestamp: Date.now(),
  }
}

function installBlockChromePerfApi(): void {
  if (typeof window === 'undefined') return

  window.__BLOCK_CHROME_LIFECYCLE_PERF__ = {
    getLast: () => lifecycleHistory[lifecycleHistory.length - 1] ?? null,
    getHistory: () => [...lifecycleHistory],
    getActiveCount: () => activeChromeBlockIds.size,
    clear: () => {
      lifecycleHistory.length = 0
      activeChromeBlockIds.clear()
    },
  }

  window.__BLOCK_ACTIVATION_PERF__ = {
    getSnapshot: buildActivationSnapshot,
    getHistory: () => [...activationHistory],
    clear: () => {
      activeReasonsByBlockId.clear()
      activationHistory.length = 0
    },
  }

  window.__EDITOR_LISTENER_PERF__ = {
    getSnapshot: buildListenerSnapshot,
    getHistory: () => [...listenerHistory],
    clear: () => {
      listenerCountsByKey.clear()
      listenerHistory.length = 0
    },
  }
}

export function recordBlockChromeMounted(params: {
  blockId: string
  setupToMountedMs: number
}): void {
  const blockId = params.blockId.trim()
  if (!blockId) return

  activeChromeBlockIds.add(blockId)
  lifecycleHistory.push({
    blockId,
    phase: 'mount',
    setupToMountedMs: Math.round(params.setupToMountedMs * 10) / 10,
    activeCount: activeChromeBlockIds.size,
    timestamp: Date.now(),
  })
  clampHistory(lifecycleHistory)
  installBlockChromePerfApi()
}

export function recordBlockChromeUnmounted(blockIdInput: string): void {
  const blockId = blockIdInput.trim()
  if (!blockId) return

  activeChromeBlockIds.delete(blockId)
  activeReasonsByBlockId.delete(blockId)
  lifecycleHistory.push({
    blockId,
    phase: 'unmount',
    activeCount: activeChromeBlockIds.size,
    timestamp: Date.now(),
  })
  clampHistory(lifecycleHistory)
  installBlockChromePerfApi()
}

export function recordBlockActivationState(params: {
  blockId: string
  active: boolean
  reasons: readonly string[]
}): void {
  const blockId = params.blockId.trim()
  if (!blockId) return

  if (params.active) {
    activeReasonsByBlockId.set(blockId, [...params.reasons])
  } else {
    activeReasonsByBlockId.delete(blockId)
  }

  activationHistory.push(buildActivationSnapshot())
  clampHistory(activationHistory)
  installBlockChromePerfApi()
}

export function recordEditorListenerAttached(params: {
  owner: string
  eventName: EditorListenerPerfEventName
}): void {
  const key = getListenerKey(params.owner, params.eventName)
  listenerCountsByKey.set(key, (listenerCountsByKey.get(key) ?? 0) + 1)
  listenerHistory.push(buildListenerSnapshot())
  clampHistory(listenerHistory)
  installBlockChromePerfApi()
}

export function recordEditorListenerDetached(params: {
  owner: string
  eventName: EditorListenerPerfEventName
}): void {
  const key = getListenerKey(params.owner, params.eventName)
  const nextCount = Math.max(0, (listenerCountsByKey.get(key) ?? 0) - 1)
  if (nextCount === 0) listenerCountsByKey.delete(key)
  else listenerCountsByKey.set(key, nextCount)
  listenerHistory.push(buildListenerSnapshot())
  clampHistory(listenerHistory)
  installBlockChromePerfApi()
}

installBlockChromePerfApi()
