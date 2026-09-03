import { describe, expect, it, vi } from 'vitest'
import { KeepAliveRegistry } from './keepAliveRegistry'
import { RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT } from './keepAliveEvents'
import {
  applyRenderVirtualizationKeepAliveCommand,
  createRegistryKeepAlivePort,
} from './keepAlivePort'

describe('createRegistryKeepAlivePort', () => {
  it('exposes a narrow owner-scoped lease port over KeepAliveRegistry', () => {
    const onAcquire = vi.fn()
    const onRelease = vi.fn()
    const registry = new KeepAliveRegistry({ onAcquire, onRelease })
    const port = createRegistryKeepAlivePort(registry)

    expect(port.acquire({ blockId: 'block-a', reason: 'revision-toolbar' })).toBe(true)
    expect(port.acquire({ blockId: 'block-a', reason: 'revision-toolbar' })).toBe(false)
    expect(registry.getReasons('block-a').has('revision-toolbar')).toBe(true)
    expect(onAcquire).toHaveBeenCalledOnce()

    expect(port.release({ blockId: 'block-a', reason: 'revision-toolbar' })).toBe(true)
    expect(registry.has('block-a')).toBe(true)
    expect(onRelease).not.toHaveBeenCalled()

    expect(port.release({ blockId: 'block-a', reason: 'revision-toolbar' })).toBe(true)
    expect(registry.has('block-a')).toBe(false)
    expect(onRelease).toHaveBeenCalledWith('block-a')
  })

  it('can release all leases for one reason without exposing registry internals', () => {
    const registry = new KeepAliveRegistry()
    const port = createRegistryKeepAlivePort(registry)

    port.acquire({ blockId: 'block-a', reason: 'focus' })
    port.acquire({ blockId: 'block-b', reason: 'focus' })
    port.acquire({ blockId: 'block-b', reason: 'pointer' })

    expect(port.releaseReason('focus')).toEqual(['block-a', 'block-b'])
    expect(registry.has('block-a')).toBe(false)
    expect(registry.getReasons('block-b').has('pointer')).toBe(true)
  })
})

describe('applyRenderVirtualizationKeepAliveCommand', () => {
  it('prefers the explicit KeepAlivePort over the legacy DOM event adapter', () => {
    const target = new EventTarget()
    const eventListener = vi.fn()
    target.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, eventListener)
    const port = {
      acquire: vi.fn(() => true),
      release: vi.fn(() => true),
      releaseReason: vi.fn(() => []),
      hasReason: vi.fn(() => false),
    }

    expect(applyRenderVirtualizationKeepAliveCommand({
      port,
      legacyTarget: target,
      command: { blockId: 'block-a', reason: 'annotation' },
      active: true,
    })).toBe(true)

    expect(port.acquire).toHaveBeenCalledWith({ blockId: 'block-a', reason: 'annotation' })
    expect(eventListener).not.toHaveBeenCalled()
  })

  it('keeps the legacy DOM event adapter only as a fallback path', () => {
    const target = new EventTarget()
    const events: unknown[] = []
    target.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
      if (event instanceof CustomEvent) events.push(event.detail)
    })

    expect(applyRenderVirtualizationKeepAliveCommand({
      legacyTarget: target,
      command: { blockId: 'block-a', reason: 'annotation' },
      active: false,
    })).toBe(true)

    expect(events).toEqual([
      { blockId: 'block-a', reason: 'annotation', active: false },
    ])
  })
})
