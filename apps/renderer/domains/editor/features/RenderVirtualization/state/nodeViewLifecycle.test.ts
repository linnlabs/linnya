// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRootBlockNodeViewLifecycleDebugSnapshot,
  getRootBlockNodeViewLifecycleEntry,
  publishRootBlockNodeViewMounted,
  resetRootBlockNodeViewLifecycleRegistry,
} from './nodeViewLifecycle'
import {
  awaitLegacyHydratedRootBlockNodeViewForTest,
  getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest,
  publishLegacyRootBlockNodeViewMountedForTest,
  publishLegacyRootBlockNodeViewUnmountedForTest,
  resetLegacyRootBlockNodeViewLifecycleRegistryForTest,
  subscribeLegacyRootBlockNodeViewLifecycleForTest,
} from '../testing/legacyOwnerFallbackTestAdapter'

describe('nodeViewLifecycle', () => {
  afterEach(() => {
    resetLegacyRootBlockNodeViewLifecycleRegistryForTest()
    vi.useRealTimers()
  })

  it('replays existing mounted entries to late subscribers', () => {
    const dom = document.createElement('div')
    publishLegacyRootBlockNodeViewMountedForTest({ blockId: 'block-a', mode: 'placeholder', dom })
    const listener = vi.fn()

    const unsubscribe = subscribeLegacyRootBlockNodeViewLifecycleForTest(listener, {
      replayExisting: true,
    })

    expect(listener).toHaveBeenCalledWith({
      type: 'mount',
      blockId: 'block-a',
      mode: 'placeholder',
      dom,
    })
    unsubscribe()
  })

  it('resolves hydrated waiters when a hydrated NodeView mounts', async () => {
    vi.useFakeTimers()
    const dom = document.createElement('div')
    const promise = awaitLegacyHydratedRootBlockNodeViewForTest('block-a', 100)

    publishLegacyRootBlockNodeViewMountedForTest({ blockId: 'block-a', mode: 'hydrated', dom })

    await expect(promise).resolves.toBe(dom)
    expect(getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest()).toMatchObject({
      mountedCount: 1,
      hydratedCount: 1,
      pendingHydrationWaiterCount: 0,
    })
  })

  it('rejects pending hydration waiters on registry reset', async () => {
    vi.useFakeTimers()
    const promise = awaitLegacyHydratedRootBlockNodeViewForTest('block-a', 100)

    resetLegacyRootBlockNodeViewLifecycleRegistryForTest()

    await expect(promise).rejects.toThrow('生命周期注册表已重置')
  })

  it('removes only the currently mounted DOM on unmount', () => {
    const oldDom = document.createElement('div')
    const newDom = document.createElement('div')
    publishLegacyRootBlockNodeViewMountedForTest({
      blockId: 'block-a',
      mode: 'placeholder',
      dom: oldDom,
    })
    publishLegacyRootBlockNodeViewMountedForTest({
      blockId: 'block-a',
      mode: 'hydrated',
      dom: newDom,
    })

    publishLegacyRootBlockNodeViewUnmountedForTest({
      blockId: 'block-a',
      mode: 'placeholder',
      dom: oldDom,
    })
    expect(getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest().mountedCount).toBe(1)

    publishLegacyRootBlockNodeViewUnmountedForTest({
      blockId: 'block-a',
      mode: 'hydrated',
      dom: newDom,
    })
    expect(getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest().mountedCount).toBe(0)
  })

  it('isolates lifecycle entries and reset by owner', () => {
    const firstOwner = {}
    const secondOwner = {}
    const firstDom = document.createElement('div')
    const secondDom = document.createElement('div')

    publishRootBlockNodeViewMounted(
      { blockId: 'shared-block', mode: 'hydrated', dom: firstDom },
      firstOwner
    )
    publishRootBlockNodeViewMounted(
      { blockId: 'shared-block', mode: 'hydrated', dom: secondDom },
      secondOwner
    )

    resetRootBlockNodeViewLifecycleRegistry(firstOwner)

    expect(getRootBlockNodeViewLifecycleDebugSnapshot(firstOwner).mountedCount).toBe(0)
    expect(getRootBlockNodeViewLifecycleDebugSnapshot(secondOwner).mountedCount).toBe(1)
    expect(getRootBlockNodeViewLifecycleEntry('shared-block', secondOwner)?.dom).toBe(secondDom)
  })
})
