import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type BlockChromeRuntimePerfModule = typeof import('./blockChromeRuntimePerf')

describe('blockChromeRuntimePerf', () => {
  let perf: BlockChromeRuntimePerfModule

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    perf = await import('./blockChromeRuntimePerf')
    window.__BLOCK_CHROME_LIFECYCLE_PERF__?.clear()
    window.__BLOCK_ACTIVATION_PERF__?.clear()
    window.__EDITOR_LISTENER_PERF__?.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tracks BlockChrome lifecycle and activation reasons', () => {
    perf.recordBlockChromeMounted({ blockId: 'block-a', setupToMountedMs: 3.21 })
    perf.recordBlockActivationState({
      blockId: 'block-a',
      active: true,
      reasons: ['visible', 'focused'],
    })

    expect(window.__BLOCK_CHROME_LIFECYCLE_PERF__?.getActiveCount()).toBe(1)
    expect(window.__BLOCK_CHROME_LIFECYCLE_PERF__?.getLast()?.setupToMountedMs).toBe(3.2)

    const activationSnapshot = window.__BLOCK_ACTIVATION_PERF__?.getSnapshot()
    expect(activationSnapshot?.activeCount).toBe(1)
    expect(activationSnapshot?.byReason.visible).toBe(1)
    expect(activationSnapshot?.byReason.focused).toBe(1)

    perf.recordBlockChromeUnmounted('block-a')
    expect(window.__BLOCK_CHROME_LIFECYCLE_PERF__?.getActiveCount()).toBe(0)
    expect(window.__BLOCK_ACTIVATION_PERF__?.getSnapshot().activeCount).toBe(0)
  })

  it('tracks editor listeners installed by BlockChrome', () => {
    perf.recordEditorListenerAttached({ owner: 'BlockChrome', eventName: 'update' })
    perf.recordEditorListenerAttached({ owner: 'BlockChrome', eventName: 'selectionUpdate' })
    perf.recordEditorListenerDetached({ owner: 'BlockChrome', eventName: 'update' })

    const snapshot = window.__EDITOR_LISTENER_PERF__?.getSnapshot()
    expect(snapshot?.total).toBe(1)
    expect(snapshot?.byEvent.update).toBe(0)
    expect(snapshot?.byEvent.selectionUpdate).toBe(1)
    expect(snapshot?.byOwner.BlockChrome).toBe(1)
  })
})
