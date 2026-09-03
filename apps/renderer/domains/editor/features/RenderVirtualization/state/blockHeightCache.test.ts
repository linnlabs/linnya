import { describe, expect, it } from 'vitest'
import { BlockHeightCache } from './blockHeightCache'

describe('BlockHeightCache', () => {
  it('returns a stable default height before a block is measured', () => {
    const cache = new BlockHeightCache()

    expect(cache.get('block-a')).toBe(120)
    expect(cache.getLayoutHeight('block-a')).toBe(125)
    expect(cache.has('block-a')).toBe(false)
  })

  it('stores measured heights and clamps pathological values', () => {
    const cache = new BlockHeightCache({
      defaultHeight: 64,
      minHeight: 32,
      maxHeight: 128,
    })

    cache.set('block-a', 96.4)
    cache.set('block-b', 4)
    cache.set('block-c', 10000)

    expect(cache.get('block-a')).toBe(96)
    expect(cache.getLayoutHeight('block-a')).toBe(101)
    expect(cache.get('block-b')).toBe(32)
    expect(cache.get('block-c')).toBe(128)
  })

  it('keeps element height separate from vertical layout span', () => {
    const cache = new BlockHeightCache()

    cache.set('block-a', {
      elementHeight: 144,
      marginBefore: 10,
      marginAfter: 5,
    })

    expect(cache.get('block-a')).toBe(144)
    expect(cache.getLayoutHeight('block-a')).toBe(159)
  })

  it('keeps measurements until explicitly deleted or cleared', () => {
    const cache = new BlockHeightCache()

    cache.set('block-a', 90)
    expect(cache.snapshot().size).toBe(1)

    cache.delete('block-a')
    expect(cache.get('block-a')).toBe(120)

    cache.set('block-a', 90)
    cache.set('block-b', 120)
    cache.clear()
    expect(cache.snapshot().size).toBe(0)
  })

  it('uses a measured average for unknown blocks after enough samples', () => {
    const cache = new BlockHeightCache()

    for (let index = 0; index < 7; index += 1) {
      cache.set(`block-${index}`, {
        elementHeight: 80,
        marginBefore: 0,
        marginAfter: 6,
      })
    }
    expect(cache.getLayoutHeight('unknown-before-threshold')).toBe(125)

    cache.set('block-7', {
      elementHeight: 88,
      marginBefore: 0,
      marginAfter: 6,
    })

    expect(cache.get('unknown-after-threshold')).toBe(81)
    expect(cache.getLayoutHeight('unknown-after-threshold')).toBe(87)
    expect(cache.snapshot().adaptiveElementHeight).toBe(81)
  })

  it('allows adaptive defaults to fit short text blocks after enough samples', () => {
    const cache = new BlockHeightCache()

    for (let index = 0; index < 8; index += 1) {
      cache.set(`short-block-${index}`, {
        elementHeight: 28,
        marginBefore: 0,
        marginAfter: 5,
      })
    }

    expect(cache.snapshot().adaptiveElementHeight).toBe(32)
    expect(cache.getLayoutHeight('unknown-short-block')).toBe(37)
  })

  it('estimates total layout height without requiring every block id', () => {
    const cache = new BlockHeightCache()

    expect(cache.estimateTotalLayoutHeight(3)).toBe(375)

    for (let index = 0; index < 8; index += 1) {
      cache.set(`short-block-${index}`, {
        elementHeight: 28,
        marginBefore: 0,
        marginAfter: 5,
      })
    }

    expect(cache.estimateTotalLayoutHeight(10000)).toBe(370000)
  })
})
