// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  buildRootBlockMetrics,
  selectVisibleRenderWindow,
  shouldPreferDomSampling,
} from './renderWindowMath'
import {
  MAX_RENDER_WINDOW_BLOCK_COUNT,
  MIN_RENDER_WINDOW_BLOCK_COUNT,
  resolveRenderWindowBlockCount,
  resolveRenderWindowOverscanPx,
} from '../renderVirtualizationConstants'

describe('renderWindowMath', () => {
  it('selects a height-cache window for ordinary scrolling without DOM input', () => {
    const blockIds = ['a', 'b', 'c', 'd']
    const { metrics, totalEstimatedHeight } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 100,
      viewportBottom: 250,
      overscanPx: 0,
      maxWindowBlockCount: 3,
      preferDomSampling: false,
    })

    expect(totalEstimatedHeight).toBe(400)
    expect(window).toEqual({
      blockIds: ['b', 'c'],
      anchorBlockId: null,
      source: 'height-cache',
    })
  })

  it('selects around sampled DOM blocks for jump correction', () => {
    const blockIds = Array.from({ length: 10 }, (_, index) => `block-${index}`)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 4,
      sampledBlockIds: ['block-7', 'block-8'],
      preferDomSampling: true,
    })

    expect(window).toEqual({
      blockIds: ['block-6', 'block-7', 'block-8', 'block-9'],
      anchorBlockId: 'block-8',
      source: 'dom-sample',
    })
  })

  it('falls back to anchor when DOM sample points miss root blocks', () => {
    const blockIds = Array.from({ length: 8 }, (_, index) => `block-${index}`)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 3,
      sampledBlockIds: [],
      anchorBlockId: 'block-6',
      preferDomSampling: true,
    })

    expect(window).toEqual({
      blockIds: ['block-5', 'block-6', 'block-7'],
      anchorBlockId: 'block-6',
      source: 'dom-anchor',
    })
  })

  it('selects around a DOM anchor even for ordinary scrolling', () => {
    const blockIds = Array.from({ length: 10 }, (_, index) => `block-${index}`)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 5,
      anchorBlockId: 'block-7',
      preferDomSampling: false,
    })

    expect(window).toEqual({
      blockIds: ['block-5', 'block-6', 'block-7', 'block-8', 'block-9'],
      anchorBlockId: 'block-7',
      source: 'dom-anchor',
    })
  })

  it('does not build height-cache metrics when a DOM anchor can select the window', () => {
    const blockIds = Array.from({ length: 10 }, (_, index) => `block-${index}`)
    const getMetricsForHeightCache = vi.fn(() => {
      const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
      return metrics
    })
    const window = selectVisibleRenderWindow({
      blockIds,
      getMetricsForHeightCache,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 5,
      anchorBlockId: 'block-7',
      preferDomSampling: false,
    })

    expect(getMetricsForHeightCache).not.toHaveBeenCalled()
    expect(window.source).toBe('dom-anchor')
    expect(window.blockIds).toEqual(['block-5', 'block-6', 'block-7', 'block-8', 'block-9'])
  })

  it('builds height-cache metrics only when DOM facts cannot select a window', () => {
    const blockIds = Array.from({ length: 5 }, (_, index) => `block-${index}`)
    const getMetricsForHeightCache = vi.fn(() => {
      const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
      return metrics
    })
    const window = selectVisibleRenderWindow({
      blockIds,
      getMetricsForHeightCache,
      viewportTop: 100,
      viewportBottom: 250,
      overscanPx: 0,
      maxWindowBlockCount: 3,
      preferDomSampling: false,
    })

    expect(getMetricsForHeightCache).toHaveBeenCalledTimes(1)
    expect(window).toEqual({
      blockIds: ['block-1', 'block-2'],
      anchorBlockId: null,
      source: 'height-cache',
    })
  })

  it('reuses the current hydrated window while the anchor stays away from the edges', () => {
    const blockIds = Array.from({ length: 120 }, (_, index) => `block-${index}`)
    const currentWindowBlockIds = blockIds.slice(20, 80)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 60,
      anchorBlockId: 'block-50',
      currentWindowBlockIds,
      allowStableWindowReuse: true,
      preferDomSampling: false,
    })

    expect(window).toEqual({
      blockIds: currentWindowBlockIds,
      anchorBlockId: 'block-50',
      source: 'dom-anchor-reuse',
    })
  })

  it('shifts the current hydrated window instead of recentering when the anchor reaches the edge', () => {
    const blockIds = Array.from({ length: 120 }, (_, index) => `block-${index}`)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 60,
      anchorBlockId: 'block-76',
      currentWindowBlockIds: blockIds.slice(20, 80),
      allowStableWindowReuse: true,
      preferDomSampling: false,
    })

    expect(window).toEqual({
      blockIds: blockIds.slice(26, 86),
      anchorBlockId: 'block-76',
      source: 'dom-anchor-shift',
    })
  })

  it('shifts the current hydrated window backward when the anchor reaches the leading edge', () => {
    const blockIds = Array.from({ length: 120 }, (_, index) => `block-${index}`)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 60,
      anchorBlockId: 'block-23',
      currentWindowBlockIds: blockIds.slice(20, 80),
      allowStableWindowReuse: true,
      preferDomSampling: false,
    })

    expect(window).toEqual({
      blockIds: blockIds.slice(14, 74),
      anchorBlockId: 'block-23',
      source: 'dom-anchor-shift',
    })
  })

  it('reuses a window at the document boundary even when the anchor cannot keep trailing headroom', () => {
    const blockIds = Array.from({ length: 120 }, (_, index) => `block-${index}`)
    const currentWindowBlockIds = blockIds.slice(60, 120)
    const { metrics } = buildRootBlockMetrics(blockIds, () => 100)
    const window = selectVisibleRenderWindow({
      blockIds,
      metrics,
      viewportTop: 0,
      viewportBottom: 200,
      overscanPx: 0,
      maxWindowBlockCount: 60,
      anchorBlockId: 'block-116',
      currentWindowBlockIds,
      allowStableWindowReuse: true,
      preferDomSampling: false,
    })

    expect(window).toEqual({
      blockIds: currentWindowBlockIds,
      anchorBlockId: 'block-116',
      source: 'dom-anchor-reuse',
    })
  })

  it('only requests DOM sampling for explicit correction reasons', () => {
    expect(shouldPreferDomSampling({
      reasonPrefersDomSampling: false,
    })).toBe(false)

    expect(shouldPreferDomSampling({
      reasonPrefersDomSampling: true,
    })).toBe(true)
  })

  it('scales default overscan and window count with viewport and block height', () => {
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 2400,
    })

    const overscanPx = resolveRenderWindowOverscanPx({ scrollRoot })
    expect(overscanPx).toBe(1800)

    expect(resolveRenderWindowBlockCount({
      viewportHeight: 2400,
      overscanPx,
      totalEstimatedHeight: 120000,
      blockCount: 1000,
    })).toBe(63)

    expect(resolveRenderWindowBlockCount({
      viewportHeight: 2400,
      overscanPx,
      totalEstimatedHeight: 240000,
      blockCount: 1000,
    })).toBe(MIN_RENDER_WINDOW_BLOCK_COUNT)

    expect(resolveRenderWindowBlockCount({
      viewportHeight: 2400,
      overscanPx,
      totalEstimatedHeight: 24000,
      blockCount: 1000,
    })).toBe(MAX_RENDER_WINDOW_BLOCK_COUNT)
  })
})
