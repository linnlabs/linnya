/**
 * nodeViewLifecycle.ts
 *
 * RootBlock NodeView 生命周期注册表。
 *
 * 中文说明：
 * - Shell / Placeholder NodeView 是 PM 创建和销毁的源头；
 * - visibility bridge、scroll handshake 不应再通过 MutationObserver / rAF 轮询猜 DOM；
 * - 这里提供当前挂载表、订阅事件，以及等待某个 blockId hydrated 的 Promise。
 */

import type { RootBlockRenderMode } from '../view/rootBlockRenderMode'
import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'

export type RootBlockNodeViewLifecycleEventType = 'mount' | 'unmount' | 'modeChanged'

export interface RootBlockNodeViewLifecycleEntry {
  blockId: string
  mode: RootBlockRenderMode
  dom: HTMLElement
}

export interface RootBlockNodeViewLifecycleEvent extends RootBlockNodeViewLifecycleEntry {
  type: RootBlockNodeViewLifecycleEventType
  previousMode?: RootBlockRenderMode
}

interface HydratedWaiter {
  resolve: (dom: HTMLElement) => void
  reject: (error: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

interface RootBlockNodeViewLifecycleRegistryState {
  entriesByBlockId: Map<string, RootBlockNodeViewLifecycleEntry>
  listeners: Set<(event: RootBlockNodeViewLifecycleEvent) => void>
  hydratedWaiters: Map<string, Set<HydratedWaiter>>
}

const legacyLifecycleState = createLifecycleState()
const lifecycleStatesByOwner = new WeakMap<RenderVirtualizationOwner, RootBlockNodeViewLifecycleRegistryState>()

function createLifecycleState(): RootBlockNodeViewLifecycleRegistryState {
  return {
    entriesByBlockId: new Map<string, RootBlockNodeViewLifecycleEntry>(),
    listeners: new Set<(event: RootBlockNodeViewLifecycleEvent) => void>(),
    hydratedWaiters: new Map<string, Set<HydratedWaiter>>(),
  }
}

function getLifecycleState(
  owner: RenderVirtualizationOwner
): RootBlockNodeViewLifecycleRegistryState {
  const existing = lifecycleStatesByOwner.get(owner)
  if (existing) return existing
  const state = createLifecycleState()
  lifecycleStatesByOwner.set(owner, state)
  return state
}

function notify(
  state: RootBlockNodeViewLifecycleRegistryState,
  event: RootBlockNodeViewLifecycleEvent
): void {
  state.listeners.forEach((listener) => listener(event))
}

function settleHydratedWaiters(
  state: RootBlockNodeViewLifecycleRegistryState,
  blockId: string,
  dom: HTMLElement
): void {
  const waiters = state.hydratedWaiters.get(blockId)
  if (!waiters) return
  state.hydratedWaiters.delete(blockId)
  waiters.forEach((waiter) => {
    clearTimeout(waiter.timeoutHandle)
    waiter.resolve(dom)
  })
}

export function publishRootBlockNodeViewMounted(
  entry: RootBlockNodeViewLifecycleEntry,
  owner: RenderVirtualizationOwner
): void {
  publishRootBlockNodeViewMountedToState(entry, getLifecycleState(owner))
}

function publishRootBlockNodeViewMountedToState(
  entry: RootBlockNodeViewLifecycleEntry,
  state: RootBlockNodeViewLifecycleRegistryState
): void {
  const previous = state.entriesByBlockId.get(entry.blockId)
  state.entriesByBlockId.set(entry.blockId, entry)
  notify(state, {
    type: previous ? 'modeChanged' : 'mount',
    previousMode: previous?.mode,
    ...entry,
  })
  if (entry.mode === 'hydrated') {
    settleHydratedWaiters(state, entry.blockId, entry.dom)
  }
}

export function publishRootBlockNodeViewUnmounted(
  entry: RootBlockNodeViewLifecycleEntry,
  owner: RenderVirtualizationOwner
): void {
  publishRootBlockNodeViewUnmountedFromState(entry, getLifecycleState(owner))
}

function publishRootBlockNodeViewUnmountedFromState(
  entry: RootBlockNodeViewLifecycleEntry,
  state: RootBlockNodeViewLifecycleRegistryState
): void {
  const current = state.entriesByBlockId.get(entry.blockId)
  if (current?.dom !== entry.dom) return
  state.entriesByBlockId.delete(entry.blockId)
  notify(state, {
    type: 'unmount',
    ...entry,
  })
}

export function getRootBlockNodeViewLifecycleEntry(
  blockId: string,
  owner: RenderVirtualizationOwner
): RootBlockNodeViewLifecycleEntry | null {
  return getLifecycleState(owner).entriesByBlockId.get(blockId) ?? null
}

export function getRootBlockNodeViewLifecycleEntries(
  owner: RenderVirtualizationOwner
): RootBlockNodeViewLifecycleEntry[] {
  return [...getLifecycleState(owner).entriesByBlockId.values()]
}

export function subscribeRootBlockNodeViewLifecycle(
  listener: (event: RootBlockNodeViewLifecycleEvent) => void,
  options: { replayExisting?: boolean; owner: RenderVirtualizationOwner }
): () => void {
  const state = getLifecycleState(options.owner)
  state.listeners.add(listener)
  if (options.replayExisting) {
    state.entriesByBlockId.forEach((entry) => {
      listener({
        type: 'mount',
        ...entry,
      })
    })
  }
  return () => {
    state.listeners.delete(listener)
  }
}

export function awaitHydratedRootBlockNodeView(
  blockId: string,
  timeoutMs: number,
  owner: RenderVirtualizationOwner
): Promise<HTMLElement> {
  const state = getLifecycleState(owner)
  const current = state.entriesByBlockId.get(blockId)
  if (current?.mode === 'hydrated') return Promise.resolve(current.dom)

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const waiters = state.hydratedWaiters.get(blockId)
      if (waiters) {
        waiters.forEach((waiter) => {
          if (waiter.timeoutHandle === timeoutHandle) waiters.delete(waiter)
        })
        if (waiters.size === 0) state.hydratedWaiters.delete(blockId)
      }
      reject(new Error(`等待 rootBlock hydrated 超时: ${blockId}`))
    }, Math.max(1, timeoutMs))

    const waiter: HydratedWaiter = { resolve, reject, timeoutHandle }
    const waiters = state.hydratedWaiters.get(blockId) ?? new Set<HydratedWaiter>()
    waiters.add(waiter)
    state.hydratedWaiters.set(blockId, waiters)
  })
}

export function resetRootBlockNodeViewLifecycleRegistry(
  owner: RenderVirtualizationOwner
): void {
  resetRootBlockNodeViewLifecycleState(getLifecycleState(owner))
}

function resetRootBlockNodeViewLifecycleState(
  state: RootBlockNodeViewLifecycleRegistryState
): void {
  state.entriesByBlockId.clear()
  state.hydratedWaiters.forEach((waiters) => {
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timeoutHandle)
      waiter.reject(new Error('RootBlock NodeView 生命周期注册表已重置'))
    })
  })
  state.hydratedWaiters.clear()
}

export function getRootBlockNodeViewLifecycleDebugSnapshot(
  owner: RenderVirtualizationOwner
): {
  mountedCount: number
  hydratedCount: number
  placeholderCount: number
  pendingHydrationWaiterCount: number
} {
  const state = getLifecycleState(owner)
  let hydratedCount = 0
  let placeholderCount = 0
  state.entriesByBlockId.forEach((entry) => {
    if (entry.mode === 'hydrated') hydratedCount += 1
    if (entry.mode === 'placeholder') placeholderCount += 1
  })
  let pendingHydrationWaiterCount = 0
  state.hydratedWaiters.forEach((waiters) => {
    pendingHydrationWaiterCount += waiters.size
  })
  return {
    mountedCount: state.entriesByBlockId.size,
    hydratedCount,
    placeholderCount,
    pendingHydrationWaiterCount,
  }
}

export function publishLegacyRootBlockNodeViewMountedForTest(
  entry: RootBlockNodeViewLifecycleEntry
): void {
  publishRootBlockNodeViewMountedToState(entry, legacyLifecycleState)
}

export function publishLegacyRootBlockNodeViewUnmountedForTest(
  entry: RootBlockNodeViewLifecycleEntry
): void {
  publishRootBlockNodeViewUnmountedFromState(entry, legacyLifecycleState)
}

export function getLegacyRootBlockNodeViewLifecycleEntryForTest(
  blockId: string
): RootBlockNodeViewLifecycleEntry | null {
  return legacyLifecycleState.entriesByBlockId.get(blockId) ?? null
}

export function getLegacyRootBlockNodeViewLifecycleEntriesForTest(): RootBlockNodeViewLifecycleEntry[] {
  return [...legacyLifecycleState.entriesByBlockId.values()]
}

export function subscribeLegacyRootBlockNodeViewLifecycleForTest(
  listener: (event: RootBlockNodeViewLifecycleEvent) => void,
  options: { replayExisting?: boolean } = {}
): () => void {
  legacyLifecycleState.listeners.add(listener)
  if (options.replayExisting) {
    legacyLifecycleState.entriesByBlockId.forEach((entry) => {
      listener({
        type: 'mount',
        ...entry,
      })
    })
  }
  return () => {
    legacyLifecycleState.listeners.delete(listener)
  }
}

export function awaitLegacyHydratedRootBlockNodeViewForTest(
  blockId: string,
  timeoutMs: number
): Promise<HTMLElement> {
  const current = legacyLifecycleState.entriesByBlockId.get(blockId)
  if (current?.mode === 'hydrated') return Promise.resolve(current.dom)

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const waiters = legacyLifecycleState.hydratedWaiters.get(blockId)
      if (waiters) {
        waiters.forEach((waiter) => {
          if (waiter.timeoutHandle === timeoutHandle) waiters.delete(waiter)
        })
        if (waiters.size === 0) legacyLifecycleState.hydratedWaiters.delete(blockId)
      }
      reject(new Error(`等待 rootBlock hydrated 超时: ${blockId}`))
    }, Math.max(1, timeoutMs))

    const waiter: HydratedWaiter = { resolve, reject, timeoutHandle }
    const waiters = legacyLifecycleState.hydratedWaiters.get(blockId) ?? new Set<HydratedWaiter>()
    waiters.add(waiter)
    legacyLifecycleState.hydratedWaiters.set(blockId, waiters)
  })
}

export function resetLegacyRootBlockNodeViewLifecycleRegistryForTest(): void {
  resetRootBlockNodeViewLifecycleState(legacyLifecycleState)
}

export function getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest(): {
  mountedCount: number
  hydratedCount: number
  placeholderCount: number
  pendingHydrationWaiterCount: number
} {
  let hydratedCount = 0
  let placeholderCount = 0
  legacyLifecycleState.entriesByBlockId.forEach((entry) => {
    if (entry.mode === 'hydrated') hydratedCount += 1
    if (entry.mode === 'placeholder') placeholderCount += 1
  })
  let pendingHydrationWaiterCount = 0
  legacyLifecycleState.hydratedWaiters.forEach((waiters) => {
    pendingHydrationWaiterCount += waiters.size
  })
  return {
    mountedCount: legacyLifecycleState.entriesByBlockId.size,
    hydratedCount,
    placeholderCount,
    pendingHydrationWaiterCount,
  }
}
