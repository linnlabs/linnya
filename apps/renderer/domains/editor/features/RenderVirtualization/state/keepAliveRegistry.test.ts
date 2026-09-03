import { describe, expect, it, vi } from 'vitest'
import { KeepAliveRegistry } from './keepAliveRegistry'

describe('KeepAliveRegistry', () => {
  it('acquires once and releases only after the last reason is removed', () => {
    const onAcquire = vi.fn()
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onAcquire, onRelease })

    expect(registry.pin('block-a', 'composition')).toBe(true)
    expect(registry.pin('block-a', 'focus')).toBe(true)
    expect(registry.pin('block-a', 'focus')).toBe(false)
    expect(onAcquire).toHaveBeenCalledTimes(1)
    expect(onAcquire).toHaveBeenCalledWith('block-a')

    expect(registry.unpin('block-a', 'composition')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()
    expect(registry.has('block-a')).toBe(true)

    expect(registry.unpin('block-a', 'focus')).toBe(true)
    expect(registry.has('block-a')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()

    expect(registry.unpin('block-a', 'focus')).toBe(true)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledWith('block-a')
    expect(registry.has('block-a')).toBe(false)
  })

  it('keeps duplicate leases for the same reason until each lease is released', () => {
    const onAcquire = vi.fn()
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onAcquire, onRelease })

    expect(registry.pin('block-a', 'interaction-open')).toBe(true)
    expect(registry.pin('block-a', 'interaction-open')).toBe(false)
    expect(registry.getReasons('block-a')).toEqual(new Set(['interaction-open']))
    expect(onAcquire).toHaveBeenCalledTimes(1)

    expect(registry.unpin('block-a', 'interaction-open')).toBe(true)
    expect(registry.has('block-a')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()

    expect(registry.unpin('block-a', 'interaction-open')).toBe(true)
    expect(registry.has('block-a')).toBe(false)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledWith('block-a')
  })

  it('keeps table resize independent from generic interaction pins', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })

    registry.pin('block-a', 'interaction-open')
    registry.pin('block-a', 'table-column-resize')

    expect(registry.unpin('block-a', 'table-column-resize')).toBe(true)
    expect(registry.has('block-a')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()

    expect(registry.unpin('block-a', 'interaction-open')).toBe(true)
    expect(registry.has('block-a')).toBe(false)
    expect(onRelease).toHaveBeenCalledWith('block-a')
  })

  it('can release one reason across blocks', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })
    registry.pin('block-a', 'focus')
    registry.pin('block-a', 'pointer')
    registry.pin('block-b', 'focus')

    expect(registry.unpinReason('focus')).toEqual(['block-a', 'block-b'])
    expect(registry.has('block-a')).toBe(true)
    expect(registry.has('block-b')).toBe(false)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledWith('block-b')
  })

  it('keeps selection leases independent from transient interaction leases', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })

    registry.pin('block-a', 'selection')
    registry.pin('block-a', 'composition')
    registry.pin('block-a', 'focus')

    registry.unpinReason('composition')
    registry.unpinReason('focus')

    expect(registry.has('block-a')).toBe(true)
    expect(registry.getReasons('block-a')).toEqual(new Set(['selection']))
    expect(onRelease).not.toHaveBeenCalled()

    registry.unpin('block-a', 'selection')

    expect(registry.has('block-a')).toBe(false)
    expect(onRelease).toHaveBeenCalledWith('block-a')
  })

  it('moves the selection lease without releasing unrelated leases on the old block', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })

    registry.pin('block-a', 'selection')
    registry.pin('block-a', 'revision-toolbar')
    registry.unpinReason('selection')
    registry.pin('block-b', 'selection')

    expect(registry.getReasons('block-a')).toEqual(new Set(['revision-toolbar']))
    expect(registry.getReasons('block-b')).toEqual(new Set(['selection']))
    expect(onRelease).not.toHaveBeenCalledWith('block-a')

    registry.unpin('block-a', 'revision-toolbar')

    expect(onRelease).toHaveBeenCalledWith('block-a')
  })

  it('releases all pinned blocks on clear', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })
    registry.pin('block-a', 'focus')
    registry.pin('block-b', 'pointer')

    registry.clear()

    expect(registry.getPinnedBlockIds()).toEqual([])
    expect(onRelease).toHaveBeenCalledWith('block-a')
    expect(onRelease).toHaveBeenCalledWith('block-b')
  })

  it('can clear without notifying downstream committers during hard cleanup', () => {
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onRelease })
    registry.pin('block-a', 'focus')

    registry.clear({ notify: false })

    expect(registry.getPinnedBlockIds()).toEqual([])
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('exposes lease counts for memory diagnostics', () => {
    const registry = new KeepAliveRegistry()
    registry.pin('block-a', 'focus')
    registry.pin('block-a', 'focus')
    registry.pin('block-a', 'interaction-open')

    expect(registry.getDebugSnapshot()).toEqual({
      pinnedBlockCount: 1,
      leaseCount: 3,
      blocks: [
        {
          blockId: 'block-a',
          leaseCount: 3,
          reasons: [
            { reason: 'focus', leaseCount: 2 },
            { reason: 'interaction-open', leaseCount: 1 },
          ],
        },
      ],
    })
  })
})
