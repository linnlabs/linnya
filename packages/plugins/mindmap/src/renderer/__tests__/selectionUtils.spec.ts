import { describe, it, expect, afterEach } from 'vitest'
import { domRect } from '../interaction/selection/utils/helpers'

const originalDomRect = globalThis.DOMRect

afterEach(() => {
  globalThis.DOMRect = originalDomRect
})

describe('selection utils domRect', () => {
  it('creates native DOMRect when available', () => {
    class FakeDOMRect {
      constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    }
    globalThis.DOMRect = FakeDOMRect as unknown as typeof DOMRect
    const rect = domRect(1, 2, 3, 4)
    expect(rect).toBeInstanceOf(FakeDOMRect)
    expect(rect.x).toBe(1)
    expect(rect.width).toBe(3)
  })

  it('falls back to polyfill when DOMRect is missing', () => {
    globalThis.DOMRect = undefined as unknown as typeof DOMRect
    const rect = domRect(5, 6, 7, 8)
    expect(rect.x).toBe(5)
    expect(rect.bottom).toBe(14)
    expect(typeof rect.toJSON).toBe('function')
  })
})
