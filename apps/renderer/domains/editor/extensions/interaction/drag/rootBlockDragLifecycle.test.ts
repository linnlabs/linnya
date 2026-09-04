// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginRootBlockDragHandlePress,
  beginRootBlockDragVisualLifecycle,
  cleanupRootBlockDragVisualLifecycle,
  endRootBlockDragInteraction,
  endRootBlockDragHandlePress,
  endRootBlockDragVisualLifecycle,
  setupRootBlockDropIndicator,
} from './rootBlockDragLifecycle'
import {
  cleanupDropIndicator,
} from './DropCursorPlugin'

afterEach(() => {
  cleanupDropIndicator()
  document.body.innerHTML = ''
  document.body.style.userSelect = ''
  document.body.removeAttribute('data-suppress-handle-hover')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('rootBlockDragLifecycle', () => {
  it('disables and restores text selection around drag handle press', () => {
    expect(beginRootBlockDragHandlePress({ button: 2 } as MouseEvent)).toBe(false)
    expect(document.body.style.userSelect).toBe('')

    expect(beginRootBlockDragHandlePress({ button: 0 } as MouseEvent)).toBe(true)
    expect(document.body.style.userSelect).toBe('none')

    endRootBlockDragHandlePress()
    expect(document.body.style.userSelect).toBe('')
  })

  it('installs drag listeners and restores handle hover on the next pointer move', () => {
    const rootBlock = document.createElement('div')
    rootBlock.className = 'root-block-outer'
    document.body.appendChild(rootBlock)
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [rootBlock]),
    })

    beginRootBlockDragVisualLifecycle()
    expect(document.body.getAttribute('data-suppress-handle-hover')).toBe('true')

    const event = new Event('dragover') as DragEvent
    Object.defineProperties(event, {
      clientX: { value: 10 },
      clientY: { value: 10 },
      dataTransfer: { value: { types: [], dropEffect: '' } },
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()

    endRootBlockDragVisualLifecycle()
    expect(document.body.getAttribute('data-suppress-handle-hover')).toBe('true')

    document.dispatchEvent(new PointerEvent('pointermove'))
    expect(document.body.hasAttribute('data-suppress-handle-hover')).toBe(false)
  })

  it('releases handle selection through the shared drag interaction boundary', () => {
    const releaseHandleSelection = vi.fn()
    beginRootBlockDragVisualLifecycle()

    endRootBlockDragInteraction({
      releaseHandleSelection,
      restoreHoverOnNextPointerMove: false,
    })

    expect(releaseHandleSelection).toHaveBeenCalledOnce()
    expect(document.body.hasAttribute('data-suppress-handle-hover')).toBe(false)
  })

  it('cleans listeners and drop indicator when a handle unmounts mid interaction', () => {
    setupRootBlockDropIndicator()
    expect(document.querySelector('.custom-drop-indicator')).not.toBeNull()

    beginRootBlockDragVisualLifecycle()
    cleanupRootBlockDragVisualLifecycle()

    expect(document.querySelector('.custom-drop-indicator')).toBeNull()
    expect(document.body.hasAttribute('data-suppress-handle-hover')).toBe(false)

    const event = new Event('dragover') as DragEvent
    Object.defineProperties(event, {
      clientX: { value: 10 },
      clientY: { value: 10 },
      dataTransfer: { value: { types: [], dropEffect: '' } },
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    // cleanup 后 document 上不应残留全局 dragover listener。
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
