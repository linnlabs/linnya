import { describe, expect, it } from 'vitest'
import { shouldPreferFrameShellPendingProjection } from './resolveShellPendingProjectionSchedule'

describe('shouldPreferFrameShellPendingProjection', () => {
  it('prefers frame projection for typed keyboard and scroll correction reasons', () => {
    expect(shouldPreferFrameShellPendingProjection({ type: 'keyboard' })).toBe(true)
    expect(shouldPreferFrameShellPendingProjection({
      type: 'scroll',
      source: 'native',
      isCorrection: true,
    })).toBe(true)
    expect(shouldPreferFrameShellPendingProjection({
      type: 'scroll',
      source: 'native',
      isJump: true,
    })).toBe(true)
  })

  it('keeps ordinary native scroll on idle projection', () => {
    expect(shouldPreferFrameShellPendingProjection({
      type: 'scroll',
      source: 'native',
    })).toBe(false)
    expect(shouldPreferFrameShellPendingProjection(undefined)).toBe(false)
  })
})
