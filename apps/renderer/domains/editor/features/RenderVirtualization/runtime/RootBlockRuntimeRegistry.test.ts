// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRootBlockRuntimeRegistry,
  RootBlockRuntimeRegistry,
  resetRootBlockRuntimeRegistry,
  type RootBlockRuntimeHandle,
} from './RootBlockRuntimeRegistry'
import {
  getLegacyRootBlockRuntimeRegistryForTest,
  resetLegacyRootBlockRuntimeRegistryForTest,
} from '../testing/legacyOwnerFallbackTestAdapter'

function createHandle(blockId: string, options: { hydrated?: boolean } = {}): RootBlockRuntimeHandle {
  const dom = document.createElement('div')
  const contentDom = options.hydrated === false ? null : document.createElement('div')
  if (contentDom) dom.appendChild(contentDom)

  return {
    blockId,
    mode: options.hydrated === false ? 'placeholder' : 'hydrated',
    getDom: () => dom,
    getContentDom: () => contentDom,
    getChromeAnchor: () => dom,
    getPos: () => 12,
    getRect: () => dom.getBoundingClientRect(),
    measure: () => 32,
  }
}

describe('RootBlockRuntimeRegistry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers and unregisters runtime handles by block id', () => {
    const registry = new RootBlockRuntimeRegistry()
    const handle = createHandle('block-a')

    const unregister = registry.register(handle)

    expect(registry.get('block-a')).toBe(handle)
    expect(registry.getHydrated('block-a')).toBe(handle)

    unregister()

    expect(registry.get('block-a')).toBeNull()
  })

  it('only lets the current handle unregister a replaced block id', () => {
    const registry = new RootBlockRuntimeRegistry()
    const oldHandle = createHandle('block-a')
    const newHandle = createHandle('block-a')

    const unregisterOld = registry.register(oldHandle)
    registry.register(newHandle)

    unregisterOld()

    expect(registry.get('block-a')).toBe(newHandle)
  })

  it('notifies subscribers and can replay existing handles', () => {
    const registry = new RootBlockRuntimeRegistry()
    const handle = createHandle('block-a')
    const listener = vi.fn()

    registry.register(handle)
    const unsubscribe = registry.subscribe(listener, { replayExisting: true })
    registry.unregister('block-a', handle)
    unsubscribe()

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['register', 'unregister'])
  })

  it('waits until a hydrated handle is registered', async () => {
    const registry = new RootBlockRuntimeRegistry()
    const handle = createHandle('block-a')
    const pending = registry.waitForHydrated('block-a', 100)

    registry.register(handle)

    await expect(pending).resolves.toBe(handle)
  })

  it('does not resolve hydrated waiters for placeholder handles', async () => {
    vi.useFakeTimers()
    const registry = new RootBlockRuntimeRegistry()
    const pending = registry.waitForHydrated('block-a', 10)
    const rejection = expect(pending).rejects.toThrow('等待 rootBlock runtime hydrated 超时')

    registry.register(createHandle('block-a', { hydrated: false }))
    await vi.advanceTimersByTimeAsync(10)

    await rejection
  })

  it('keeps isolated registry instances from clearing each other', () => {
    const firstRegistry = new RootBlockRuntimeRegistry()
    const secondRegistry = new RootBlockRuntimeRegistry()
    const firstHandle = createHandle('block-a')
    const secondHandle = createHandle('block-a')

    firstRegistry.register(firstHandle)
    secondRegistry.register(secondHandle)

    firstRegistry.clear()

    expect(firstRegistry.get('block-a')).toBeNull()
    expect(secondRegistry.get('block-a')).toBe(secondHandle)
  })

  it('keeps owner-scoped registries isolated from legacy and other owners', () => {
    const firstOwner = {}
    const secondOwner = {}
    const legacyHandle = createHandle('block-a')
    const firstHandle = createHandle('block-a')
    const secondHandle = createHandle('block-a')

    getLegacyRootBlockRuntimeRegistryForTest().register(legacyHandle)
    getRootBlockRuntimeRegistry(firstOwner).register(firstHandle)
    getRootBlockRuntimeRegistry(secondOwner).register(secondHandle)

    resetRootBlockRuntimeRegistry(firstOwner)

    expect(getRootBlockRuntimeRegistry(firstOwner).get('block-a')).toBeNull()
    expect(getRootBlockRuntimeRegistry(secondOwner).get('block-a')).toBe(secondHandle)
    expect(getLegacyRootBlockRuntimeRegistryForTest().get('block-a')).toBe(legacyHandle)

    resetLegacyRootBlockRuntimeRegistryForTest()
    resetRootBlockRuntimeRegistry(secondOwner)
  })

  it('rejects pending hydrated waiters and emits clear events for registered blocks', async () => {
    vi.useFakeTimers()
    const registry = new RootBlockRuntimeRegistry()
    const listener = vi.fn()
    registry.register(createHandle('block-a'))
    const pending = registry.waitForHydrated('block-b', 100)
    const rejection = expect(pending).rejects.toThrow('RootBlock runtime registry 已重置')
    registry.subscribe(listener)

    registry.clear()

    expect(registry.getDebugSnapshot()).toEqual({
      registeredCount: 0,
      hydratedCount: 0,
      placeholderCount: 0,
      pendingHydratedWaiterCount: 0,
    })
    expect(listener).toHaveBeenCalledWith({
      type: 'clear',
      blockId: 'block-a',
      handle: null,
    })
    await rejection
  })
})
