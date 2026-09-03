// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { getRootBlockRuntimeRegistry } from '../runtime/RootBlockRuntimeRegistry'
import {
  getRenderVirtualizationBlockHeight,
  recordRenderVirtualizationBlockHeight,
} from '../state/blockHeightCacheRegistry'
import {
  getRootBlockNodeViewLifecycleEntry,
  publishRootBlockNodeViewMounted,
} from '../state/nodeViewLifecycle'
import { createVirtualizationIntegrationHarness } from './virtualizationIntegrationHarness'

function createMeasuredBlock(height: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      height,
      width: 100,
      top: 0,
      bottom: height,
    }),
  })
  return el
}

describe('RenderVirtualization per-editor registry design gate', () => {
  it('keeps editor B runtime, lifecycle and height-cache state when editor A is cleaned up', () => {
    const first = createVirtualizationIntegrationHarness({
      blockCount: 20,
      blockIdPrefix: 'editor-a-block',
      maxWindowBlockCount: 4,
    })
    const second = createVirtualizationIntegrationHarness({
      blockCount: 20,
      blockIdPrefix: 'editor-b-block',
      maxWindowBlockCount: 4,
    })

    try {
      first.flushAllFrames()
      first.syncRuntimeHandlesFromPluginState()
      second.flushAllFrames()
      second.syncRuntimeHandlesFromPluginState()

      const secondHydratedBlockId = second.engine.getSnapshot().hydratedBlockIds[0]
      expect(getRootBlockRuntimeRegistry(second.editor).getHydrated(secondHydratedBlockId)).not.toBeNull()
      const firstLifecycleDom = document.createElement('div')
      const secondLifecycleDom = document.createElement('div')
      publishRootBlockNodeViewMounted(
        { blockId: 'shared-lifecycle-block', mode: 'hydrated', dom: firstLifecycleDom },
        first.editor
      )
      publishRootBlockNodeViewMounted(
        { blockId: 'shared-lifecycle-block', mode: 'hydrated', dom: secondLifecycleDom },
        second.editor
      )
      recordRenderVirtualizationBlockHeight(
        'shared-height-block',
        createMeasuredBlock(180),
        first.editor
      )
      recordRenderVirtualizationBlockHeight(
        'shared-height-block',
        createMeasuredBlock(72),
        second.editor
      )

      // 中文说明：per-editor 运行期表的关键门禁是 cleanup 只能清理当前 editor。
      // Runtime、NodeView lifecycle 和 HeightCache 三条路径都必须保持同一隔离语义。
      first.cleanup()
      expect(getRootBlockRuntimeRegistry(second.editor).getHydrated(secondHydratedBlockId)).not.toBeNull()
      expect(getRootBlockNodeViewLifecycleEntry('shared-lifecycle-block', second.editor)?.dom).toBe(
        secondLifecycleDom
      )
      expect(getRenderVirtualizationBlockHeight('shared-height-block', second.editor)).toBe(72)
    } finally {
      second.cleanup()
    }
  })
})
