// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRootBlockRuntimeRegistry } from '../runtime/RootBlockRuntimeRegistry'
import { SCROLL_SETTLE_CORRECTION_MS } from '../renderVirtualizationConstants'
import { resolveBlockChromeRenderPlans } from '../../../ui/blockChromeHost/functions/resolveBlockChromeRenderPlans'
import { resolveBlockChromeHostSurfaceTargets } from '../../../ui/blockChromeHost/functions/resolveBlockChromeHostSurfaceTargets'
import type { ActiveChromeBlock } from '../../../ui/blockChromeHost/definitions/activeChromeBlocks'
import { createVirtualizationIntegrationHarness, type VirtualizationIntegrationHarness } from './virtualizationIntegrationHarness'

function createTargetReadyBlockIds(
  harness: VirtualizationIntegrationHarness,
  blockIds: readonly string[]
): ReadonlySet<string> {
  const registry = getRootBlockRuntimeRegistry(harness.editor)
  return new Set(blockIds.filter((blockId) => registry.getHydrated(blockId)?.getChromeAnchor()))
}

describe('RenderVirtualization integration harness', () => {
  let harness: VirtualizationIntegrationHarness | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    harness?.cleanup()
    harness = null
    vi.useRealTimers()
  })

  it('connects engine hydrated window, runtime handles, and BlockChromeHost surface targets', () => {
    const currentHarness = createVirtualizationIntegrationHarness({
      blockCount: 40,
      maxWindowBlockCount: 6,
    })
    harness = currentHarness
    currentHarness.flushAllFrames()
    currentHarness.syncRuntimeHandlesFromPluginState()
    const hydratedBlockId = currentHarness.engine.getSnapshot().hydratedBlockIds[0]
    const offscreenBlockId = 'block-30'
    const activeBlocks: ActiveChromeBlock[] = [
      {
        blockId: hydratedBlockId,
        sources: ['focused', 'revision-toolbar', 'history-mode'],
      },
      {
        blockId: offscreenBlockId,
        sources: ['focused', 'revision-toolbar', 'history-mode'],
      },
    ]
    const renderPlans = resolveBlockChromeRenderPlans({
      activeBlocks,
      targetReadyBlockIds: createTargetReadyBlockIds(
        currentHarness,
        activeBlocks.map((block) => block.blockId)
      ),
    })

    const surfaceTargets = resolveBlockChromeHostSurfaceTargets({
      shouldRender: true,
      renderPlans,
      hydratedRevisionIndicatorBlockIds: [hydratedBlockId, offscreenBlockId],
      getRuntimeHandle: (blockId) => getRootBlockRuntimeRegistry(currentHarness.editor).getHydrated(blockId),
    })

    expect(renderPlans).toEqual([
      {
        blockId: hydratedBlockId,
        sources: ['focused', 'revision-toolbar', 'history-mode'],
        surfaces: ['left-handle', 'annotation-handle', 'revision-toolbar', 'history-panel'],
        targetReady: true,
      },
      {
        blockId: offscreenBlockId,
        sources: ['focused', 'revision-toolbar', 'history-mode'],
        surfaces: ['left-handle', 'annotation-handle', 'revision-toolbar', 'history-panel'],
        targetReady: false,
      },
    ])
    expect(surfaceTargets.map((target) => `${target.kind}:${target.blockId}`)).toEqual([
      `left-handle:${hydratedBlockId}`,
      `annotation-handle:${hydratedBlockId}`,
      `revision-indicator:${hydratedBlockId}`,
      `revision-toolbar:${hydratedBlockId}`,
      `history-panel:${hydratedBlockId}`,
    ])
  })

  it('resolves BlockChromeHost targets from the current editor owner when block ids overlap', () => {
    const first = createVirtualizationIntegrationHarness({
      blockCount: 20,
      blockIdPrefix: 'shared-block',
      maxWindowBlockCount: 4,
    })
    const second = createVirtualizationIntegrationHarness({
      blockCount: 20,
      blockIdPrefix: 'shared-block',
      maxWindowBlockCount: 4,
    })

    try {
      first.flushAllFrames()
      first.syncRuntimeHandlesFromPluginState()
      second.flushAllFrames()
      second.syncRuntimeHandlesFromPluginState()

      const blockId = second.engine.getSnapshot().hydratedBlockIds[0]
      const activeBlocks: ActiveChromeBlock[] = [{
        blockId,
        sources: ['focused', 'revision-toolbar', 'history-mode'],
      }]
      const renderPlans = resolveBlockChromeRenderPlans({
        activeBlocks,
        targetReadyBlockIds: createTargetReadyBlockIds(second, [blockId]),
      })
      const resolveSecondOwnerTargets = () => resolveBlockChromeHostSurfaceTargets({
        shouldRender: true,
        renderPlans,
        hydratedRevisionIndicatorBlockIds: [blockId],
        getRuntimeHandle: (targetBlockId) => getRootBlockRuntimeRegistry(second.editor).getHydrated(targetBlockId),
      })

      const targets = resolveSecondOwnerTargets()
      expect(targets).toHaveLength(5)
      targets.forEach((target) => {
        expect(second.editorRoot.contains(target.mountElement)).toBe(true)
        expect(first.editorRoot.contains(target.mountElement)).toBe(false)
      })

      first.cleanup()

      // 中文说明：Host target 是 action-time owner 查询，不能因为另一个 editor
      // cleanup 了同名 blockId 的 runtime handle，就把当前 editor 的 Teleport 目标清掉。
      const targetsAfterFirstCleanup = resolveSecondOwnerTargets()
      expect(targetsAfterFirstCleanup).toHaveLength(5)
      targetsAfterFirstCleanup.forEach((target) => {
        expect(second.editorRoot.contains(target.mountElement)).toBe(true)
      })
    } finally {
      first.cleanup()
      second.cleanup()
    }
  })

  it('keeps hydrated window stable while dragging the native scrollbar and refreshes after release', () => {
    harness = createVirtualizationIntegrationHarness({
      blockCount: 120,
      maxWindowBlockCount: 8,
      clientHeight: 240,
      estimatedDocumentHeight: 14400,
    })
    harness.flushAllFrames()
    const initialSnapshot = harness.engine.getSnapshot()

    harness.scrollRoot.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 790,
      clientY: 120,
    }))
    harness.setScrollTop(3600)
    harness.scrollRoot.dispatchEvent(new Event('scroll'))
    harness.flushAllFrames()
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS * 2)

    expect(harness.engine.getSnapshot().hydratedBlockIds).toEqual(initialSnapshot.hydratedBlockIds)

    window.dispatchEvent(new MouseEvent('mouseup'))
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)

    const afterReleaseSnapshot = harness.engine.getSnapshot()
    expect(afterReleaseSnapshot.reason).toBe('scroll-correction')
    expect(afterReleaseSnapshot.hydratedBlockIds).not.toEqual(initialSnapshot.hydratedBlockIds)
    expect(afterReleaseSnapshot.scrollTop).toBe(3600)
  })

  it('cleanup cancels queued refreshes and clears runtime handles owned by the engine lifecycle', () => {
    harness = createVirtualizationIntegrationHarness({
      blockCount: 30,
      maxWindowBlockCount: 5,
    })
    harness.flushAllFrames()
    harness.syncRuntimeHandlesFromPluginState()
    expect(getRootBlockRuntimeRegistry(harness.editor).getDebugSnapshot().registeredCount).toBeGreaterThan(0)

    harness.engine.scheduleRefresh({ type: 'scheduled', label: 'after-cleanup' })
    expect(harness.pendingFrameCount()).toBe(1)

    harness.cleanup()
    harness.flushAllFrames()

    expect(getRootBlockRuntimeRegistry(harness.editor).getDebugSnapshot()).toEqual({
      registeredCount: 0,
      hydratedCount: 0,
      placeholderCount: 0,
      pendingHydratedWaiterCount: 0,
    })
    expect(harness.engine.getSnapshot().hydratedBlockIds).toEqual([])
  })
})
