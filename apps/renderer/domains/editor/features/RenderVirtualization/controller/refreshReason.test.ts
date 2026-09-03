import { describe, expect, it } from 'vitest'
import {
  formatRenderVirtualizationRefreshReason,
  mergeRenderVirtualizationRefreshReasons,
  normalizeRenderVirtualizationRefreshReason,
  shouldPreferDomSamplingForReason,
} from './refreshReason'

describe('refreshReason', () => {
  it('normalizes legacy string reasons to typed reasons', () => {
    expect(normalizeRenderVirtualizationRefreshReason('scroll-jump')).toEqual({
      type: 'scroll',
      source: 'native',
      isJump: true,
    })
    expect(normalizeRenderVirtualizationRefreshReason('editor-scroll')).toEqual({
      type: 'scroll',
      source: 'editor',
    })
  })

  it('formats typed reasons for existing perf snapshots', () => {
    expect(formatRenderVirtualizationRefreshReason({
      type: 'scroll',
      source: 'native',
      isCorrection: true,
    })).toBe('scroll-correction')
  })

  it('prioritizes jump/correction reasons when multiple triggers are batched', () => {
    const merged = mergeRenderVirtualizationRefreshReasons([
      { type: 'scheduled', label: 'scheduled' },
      { type: 'scroll', source: 'editor' },
      { type: 'scroll', source: 'native', isJump: true },
    ])

    expect(merged).toEqual({
      type: 'scroll',
      source: 'native',
      isJump: true,
    })
  })

  it('uses typed fields instead of reason substring matching for DOM sampling policy', () => {
    expect(shouldPreferDomSamplingForReason({
      type: 'manual',
      label: 'editor-scroll-but-not-a-scroll-event',
    })).toBe(false)
    expect(shouldPreferDomSamplingForReason({
      type: 'scroll',
      source: 'editor',
    })).toBe(true)
  })
})
