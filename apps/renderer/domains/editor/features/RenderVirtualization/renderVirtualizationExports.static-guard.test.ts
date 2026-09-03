import { describe, expect, it } from 'vitest'
import * as publicApi from './index'

const internalOnlyRuntimeKeys = [
  'createRenderVirtualizationPlugin',
  'getRenderVirtualizationState',
  'prepareInitialRenderVirtualizationState',
  'renderVirtualizationPluginKey',
  'registerRootBlockRuntimeHandle',
  'resetRootBlockRuntimeRegistry',
  'resetRootBlockNodeViewLifecycleRegistry',
  'publishRootBlockNodeViewMounted',
  'publishRootBlockNodeViewUnmounted',
  'getRootBlockRuntimeRegistry',
  'createRootBlockDomNodeView',
  'createPlaceholderShellView',
  'getRenderVirtualizationBlockHeightCacheSnapshot',
  'recordRenderVirtualizationBlockHeight',
  'RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT',
  'dispatchRenderVirtualizationKeepAlive',
] as const

describe('RenderVirtualization public API boundary', () => {
  it('does not expose internal plugin, registry, lifecycle, or NodeView write APIs from the feature root', () => {
    const exportedKeys = new Set(Object.keys(publicApi))

    internalOnlyRuntimeKeys.forEach((key) => {
      expect(exportedKeys.has(key)).toBe(false)
    })
  })
})
