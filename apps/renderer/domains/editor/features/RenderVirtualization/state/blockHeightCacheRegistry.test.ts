// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { BlockHeightCache } from './blockHeightCache'
import {
  getRenderVirtualizationBlockHeight,
  getRenderVirtualizationBlockHeightCacheSnapshot,
  recordRenderVirtualizationBlockHeight,
  resetRenderVirtualizationBlockHeightCache,
} from './blockHeightCacheRegistry'
import {
  getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest,
  getLegacyRenderVirtualizationBlockHeightForTest,
  getLegacyRenderVirtualizationBlockLayoutHeightForTest,
  recordLegacyRenderVirtualizationBlockHeightForTest,
  resetLegacyRenderVirtualizationBlockHeightCacheForTest,
} from '../testing/legacyOwnerFallbackTestAdapter'

describe('blockHeightCacheRegistry', () => {
  it('records measured rootBlock height and resets between documents', () => {
    resetLegacyRenderVirtualizationBlockHeightCacheForTest()

    const el = document.createElement('div')
    el.style.marginTop = '8px'
    el.style.marginBottom = '5px'
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        height: 144,
        width: 100,
        top: 0,
        bottom: 144,
      }),
    })

    recordLegacyRenderVirtualizationBlockHeightForTest('block-a', el)

    expect(getLegacyRenderVirtualizationBlockHeightForTest('block-a')).toBe(144)
    expect(getLegacyRenderVirtualizationBlockLayoutHeightForTest('block-a')).toBe(157)
    expect(getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest().size).toBe(1)

    resetLegacyRenderVirtualizationBlockHeightCacheForTest()

    expect(getLegacyRenderVirtualizationBlockHeightForTest('block-a')).toBe(120)
    expect(getLegacyRenderVirtualizationBlockLayoutHeightForTest('block-a')).toBe(125)
    expect(getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest().size).toBe(0)
  })

  it('keeps standalone height cache instances isolated for future per-editor ownership', () => {
    const firstCache = new BlockHeightCache({ defaultHeight: 100 })
    const secondCache = new BlockHeightCache({ defaultHeight: 100 })

    firstCache.set('block-a', 180)
    secondCache.set('block-a', 64)
    firstCache.clear()

    expect(firstCache.get('block-a')).toBe(100)
    expect(secondCache.get('block-a')).toBe(64)
  })

  it('isolates measured heights and reset by owner', () => {
    const firstOwner = {}
    const secondOwner = {}
    const firstEl = document.createElement('div')
    const secondEl = document.createElement('div')

    Object.defineProperty(firstEl, 'getBoundingClientRect', {
      value: () => ({ height: 180, width: 100, top: 0, bottom: 180 }),
    })
    Object.defineProperty(secondEl, 'getBoundingClientRect', {
      value: () => ({ height: 72, width: 100, top: 0, bottom: 72 }),
    })

    recordRenderVirtualizationBlockHeight('shared-block', firstEl, firstOwner)
    recordRenderVirtualizationBlockHeight('shared-block', secondEl, secondOwner)
    resetRenderVirtualizationBlockHeightCache(firstOwner)

    expect(getRenderVirtualizationBlockHeight('shared-block', firstOwner)).toBe(120)
    expect(getRenderVirtualizationBlockHeight('shared-block', secondOwner)).toBe(72)
    expect(getRenderVirtualizationBlockHeightCacheSnapshot(secondOwner).size).toBe(1)
  })
})
