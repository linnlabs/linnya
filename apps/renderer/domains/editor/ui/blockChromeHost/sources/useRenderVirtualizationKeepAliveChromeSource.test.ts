// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type Ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import {
  useRenderVirtualizationKeepAliveChromeSource,
} from './useRenderVirtualizationKeepAliveChromeSource'
import type {
  RenderVirtualizationEngine,
  RenderVirtualizationKeepAlivePort,
  RenderVirtualizationEngineSnapshot,
} from '../../../features/RenderVirtualization'

function createSnapshot(pinnedBlockIds: readonly string[]): RenderVirtualizationEngineSnapshot {
  return {
    version: 1,
    reason: 'test',
    refreshReason: { type: 'manual', label: 'test' },
    capturedAt: 1,
    virtualizationEnabled: true,
    visibleBlockIds: [],
    hydratedBlockIds: [],
    pinnedBlockIds,
    requestedHydrateBlockIds: [],
    requestedDehydrateBlockIds: [],
    scrollTop: 0,
    viewportTop: 0,
    viewportBottom: 0,
    totalEstimatedHeight: 0,
  }
}

function createEngineHarness(initialPinnedBlockIds: readonly string[]): {
  engine: RenderVirtualizationEngine
  publish: (pinnedBlockIds: readonly string[]) => void
  listenerCount: () => number
} {
  let snapshot = createSnapshot(initialPinnedBlockIds)
  const listeners = new Set<(snapshot: RenderVirtualizationEngineSnapshot) => void>()
  const keepAlivePort: RenderVirtualizationKeepAlivePort = {
    acquire: () => true,
    release: () => true,
    releaseReason: () => [],
    hasReason: () => false,
  }
  return {
    engine: {
      keepAlivePort,
      scheduleRefresh: () => undefined,
      refreshNow: () => snapshot,
      remeasureHydratedWindow: () => undefined,
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      cleanup: () => undefined,
    },
    publish: (pinnedBlockIds) => {
      snapshot = createSnapshot(pinnedBlockIds)
      listeners.forEach((listener) => listener(snapshot))
    },
    listenerCount: () => listeners.size,
  }
}

describe('useRenderVirtualizationKeepAliveChromeSource', () => {
  const mountedApps: ReturnType<typeof createApp>[] = []

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount())
    mountedApps.length = 0
  })

  it('reads pinned block ids from the public engine snapshot', async () => {
    const harness = createEngineHarness(['root-a'])
    let source: Ref<string[]> | undefined

    const Host = defineComponent({
      setup() {
        source = useRenderVirtualizationKeepAliveChromeSource({}, harness.engine)
        return () => h('div')
      },
    })

    const app = createApp(Host)
    mountedApps.push(app)
    app.mount(document.createElement('div'))

    if (!source) throw new Error('chrome source was not initialized')
    expect(source.value).toEqual(['root-a'])
    expect(harness.listenerCount()).toBe(1)

    harness.publish(['root-b', 'root-c'])
    await nextTick()

    expect(source.value).toEqual(['root-b', 'root-c'])

    app.unmount()
    expect(harness.listenerCount()).toBe(0)
  })
})
