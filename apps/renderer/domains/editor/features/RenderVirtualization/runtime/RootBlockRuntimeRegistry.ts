import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'
import type { RootBlockRenderMode } from '../view/rootBlockRenderMode'

/**
 * RootBlock 运行时句柄。
 *
 * 中文说明：
 * - 句柄只暴露 action-time API，不暴露 Vue ref / computed 等响应式状态；
 * - 后续裸 DOM NodeView 与 BlockChrome 中央化都会通过这层拿 DOM、contentDOM、位置和尺寸；
 * - 这样可以把“块壳运行时能力”和“当前是否由 Vue 组件实现”解耦。
 */
export interface RootBlockRuntimeHandle {
  blockId: string
  mode: RootBlockRenderMode
  getDom(): HTMLElement | null
  getContentDom(): HTMLElement | null
  getChromeAnchor(): HTMLElement | null
  getRevisionHeaderMount?(): HTMLElement | null
  getPos(): number | null
  getRect(): DOMRect | null
  measure(): number | null
}

export type RootBlockRuntimeRegistryEventType = 'register' | 'replace' | 'unregister' | 'clear'

export interface RootBlockRuntimeRegistryEvent {
  type: RootBlockRuntimeRegistryEventType
  blockId: string
  handle: RootBlockRuntimeHandle | null
  previousHandle?: RootBlockRuntimeHandle | null
}

export interface RootBlockRuntimeRegistryDebugSnapshot {
  registeredCount: number
  hydratedCount: number
  placeholderCount: number
  pendingHydratedWaiterCount: number
}

interface HydratedHandleWaiter {
  resolve: (handle: RootBlockRuntimeHandle) => void
  reject: (error: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

type RootBlockRuntimeRegistryListener = (event: RootBlockRuntimeRegistryEvent) => void

export type RootBlockRuntimeRegistryOwner = RenderVirtualizationOwner

function isHydratedHandle(handle: RootBlockRuntimeHandle | null | undefined): handle is RootBlockRuntimeHandle {
  return handle?.mode === 'hydrated' && handle.getDom() !== null && handle.getContentDom() !== null
}

export class RootBlockRuntimeRegistry {
  private readonly handlesByBlockId = new Map<string, RootBlockRuntimeHandle>()
  private readonly listeners = new Set<RootBlockRuntimeRegistryListener>()
  private readonly hydratedHandleWaiters = new Map<string, Set<HydratedHandleWaiter>>()

  register(handle: RootBlockRuntimeHandle): () => void {
    const blockId = handle.blockId
    if (!blockId) return () => {}

    const previousHandle = this.handlesByBlockId.get(blockId) ?? null
    this.handlesByBlockId.set(blockId, handle)

    this.notify({
      type: previousHandle ? 'replace' : 'register',
      blockId,
      handle,
      previousHandle,
    })
    this.settleHydratedWaiters(blockId, handle)

    return () => {
      this.unregister(blockId, handle)
    }
  }

  unregister(blockId: string, expectedHandle?: RootBlockRuntimeHandle): boolean {
    const currentHandle = this.handlesByBlockId.get(blockId) ?? null
    if (!currentHandle) return false
    if (expectedHandle && currentHandle !== expectedHandle) return false

    this.handlesByBlockId.delete(blockId)
    this.notify({
      type: 'unregister',
      blockId,
      handle: null,
      previousHandle: currentHandle,
    })
    return true
  }

  get(blockId: string): RootBlockRuntimeHandle | null {
    return this.handlesByBlockId.get(blockId) ?? null
  }

  getHydrated(blockId: string): RootBlockRuntimeHandle | null {
    const handle = this.get(blockId)
    return isHydratedHandle(handle) ? handle : null
  }

  forEach(callback: (handle: RootBlockRuntimeHandle) => void): void {
    const handles = [...this.handlesByBlockId.values()]
    handles.forEach(callback)
  }

  subscribe(listener: RootBlockRuntimeRegistryListener, options: { replayExisting?: boolean } = {}): () => void {
    this.listeners.add(listener)
    if (options.replayExisting) {
      this.handlesByBlockId.forEach((handle, blockId) => {
        listener({
          type: 'register',
          blockId,
          handle,
        })
      })
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  waitForHydrated(blockId: string, timeoutMs: number): Promise<RootBlockRuntimeHandle> {
    const currentHandle = this.getHydrated(blockId)
    if (currentHandle) return Promise.resolve(currentHandle)

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const waiters = this.hydratedHandleWaiters.get(blockId)
        if (waiters) {
          waiters.forEach((waiter) => {
            if (waiter.timeoutHandle === timeoutHandle) waiters.delete(waiter)
          })
          if (waiters.size === 0) this.hydratedHandleWaiters.delete(blockId)
        }
        reject(new Error(`等待 rootBlock runtime hydrated 超时: ${blockId}`))
      }, Math.max(1, timeoutMs))

      const waiter: HydratedHandleWaiter = { resolve, reject, timeoutHandle }
      const waiters = this.hydratedHandleWaiters.get(blockId) ?? new Set<HydratedHandleWaiter>()
      waiters.add(waiter)
      this.hydratedHandleWaiters.set(blockId, waiters)
    })
  }

  clear(): void {
    const blockIds = [...this.handlesByBlockId.keys()]
    this.handlesByBlockId.clear()
    blockIds.forEach((blockId) => {
      this.notify({
        type: 'clear',
        blockId,
        handle: null,
      })
    })
    this.rejectHydratedWaiters(new Error('RootBlock runtime registry 已重置'))
  }

  getDebugSnapshot(): RootBlockRuntimeRegistryDebugSnapshot {
    let hydratedCount = 0
    let placeholderCount = 0
    this.handlesByBlockId.forEach((handle) => {
      if (handle.mode === 'hydrated') hydratedCount += 1
      if (handle.mode === 'placeholder') placeholderCount += 1
    })

    let pendingHydratedWaiterCount = 0
    this.hydratedHandleWaiters.forEach((waiters) => {
      pendingHydratedWaiterCount += waiters.size
    })

    return {
      registeredCount: this.handlesByBlockId.size,
      hydratedCount,
      placeholderCount,
      pendingHydratedWaiterCount,
    }
  }

  private notify(event: RootBlockRuntimeRegistryEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }

  private settleHydratedWaiters(blockId: string, handle: RootBlockRuntimeHandle): void {
    if (!isHydratedHandle(handle)) return
    const waiters = this.hydratedHandleWaiters.get(blockId)
    if (!waiters) return

    this.hydratedHandleWaiters.delete(blockId)
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timeoutHandle)
      waiter.resolve(handle)
    })
  }

  private rejectHydratedWaiters(error: Error): void {
    this.hydratedHandleWaiters.forEach((waiters) => {
      waiters.forEach((waiter) => {
        clearTimeout(waiter.timeoutHandle)
        waiter.reject(error)
      })
    })
    this.hydratedHandleWaiters.clear()
  }
}

const legacyRootBlockRuntimeRegistry = new RootBlockRuntimeRegistry()
const registriesByOwner = new WeakMap<RootBlockRuntimeRegistryOwner, RootBlockRuntimeRegistry>()

export function getRootBlockRuntimeRegistry(
  owner: RootBlockRuntimeRegistryOwner
): RootBlockRuntimeRegistry {
  const existingRegistry = registriesByOwner.get(owner)
  if (existingRegistry) return existingRegistry

  const registry = new RootBlockRuntimeRegistry()
  registriesByOwner.set(owner, registry)
  return registry
}

export function registerRootBlockRuntimeHandle(
  handle: RootBlockRuntimeHandle,
  owner: RootBlockRuntimeRegistryOwner
): () => void {
  return getRootBlockRuntimeRegistry(owner).register(handle)
}

export function resetRootBlockRuntimeRegistry(
  owner: RootBlockRuntimeRegistryOwner
): void {
  getRootBlockRuntimeRegistry(owner).clear()
}

export function getLegacyRootBlockRuntimeRegistryForTest(): RootBlockRuntimeRegistry {
  return legacyRootBlockRuntimeRegistry
}

export function registerLegacyRootBlockRuntimeHandleForTest(
  handle: RootBlockRuntimeHandle
): () => void {
  return legacyRootBlockRuntimeRegistry.register(handle)
}

export function resetLegacyRootBlockRuntimeRegistryForTest(): void {
  legacyRootBlockRuntimeRegistry.clear()
}
