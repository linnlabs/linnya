// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCROLL_SETTLE_CORRECTION_MS } from '../renderVirtualizationConstants'
import { createVirtualViewportTracker } from './viewportTracker'

function setElementMetric(
  el: HTMLElement,
  key: 'clientHeight' | 'scrollHeight',
  value: number
): void {
  Object.defineProperty(el, key, {
    configurable: true,
    value,
  })
}

function setElementRect(el: HTMLElement, rect: { left: number; right: number; top: number; bottom: number }): void {
  el.getBoundingClientRect = () => ({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect)
}

describe('createVirtualViewportTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('suppresses hydrate refreshes while the native scrollbar thumb is being dragged', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 92, clientY: 200 }))
    scrollRoot.scrollTop = 1200
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    expect(refreshNow).not.toHaveBeenCalled()

    window.dispatchEvent(new MouseEvent('mouseup'))
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)

    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('keeps repeated up-and-down scrollbar thumb drags from scheduling hydrate work before release', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 92, clientY: 200 }))

    for (const scrollTop of [1200, 2600, 900, 3200, 1400, 3600]) {
      scrollRoot.scrollTop = scrollTop
      scrollRoot.dispatchEvent(new Event('scroll'))
    }

    // 中文说明：这条测试固化真实体感门禁。按住原生滚动条反复上下时，
    // 不能在拖拽中途 hydrate/dehydrate，否则 scrollHeight 会变化，滚动条拇指会逐渐脱离鼠标。
    expect(scheduleRefresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS * 3)
    expect(refreshNow).not.toHaveBeenCalled()

    window.dispatchEvent(new MouseEvent('mouseup'))
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)

    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('keeps ordinary content-area scrolling on the normal scheduled refresh path', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow: vi.fn(),
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 200 }))
    scrollRoot.scrollTop = 300
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).toHaveBeenCalledWith({ type: 'scroll', source: 'native' })
    tracker.cleanup()
  })

  it('does not enter scrollbar-drag mode when the pointer starts outside the scroll root vertical range', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 92, clientY: 900 }))
    scrollRoot.scrollTop = 1800
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).toHaveBeenCalledWith({ type: 'scroll', source: 'native' })
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('does not enter scrollbar-drag mode when the scroll root has no overflow', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 800)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow: vi.fn(),
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 92, clientY: 200 }))
    scrollRoot.scrollTop = 160
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).toHaveBeenCalledWith({ type: 'scroll', source: 'native' })
    tracker.cleanup()
  })

  it('keeps touchpad-like small scroll steps on the scheduled refresh path', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow: vi.fn(),
      scheduleRefresh,
    })

    tracker.install()
    for (const scrollTop of [24, 56, 104, 160]) {
      scrollRoot.scrollTop = scrollTop
      scrollRoot.dispatchEvent(new Event('scroll'))
    }

    expect(scheduleRefresh).toHaveBeenCalledTimes(4)
    for (const call of scheduleRefresh.mock.calls) {
      expect(call[0]).toEqual({ type: 'scroll', source: 'native' })
    }
    tracker.cleanup()
  })

  it('allows a large programmatic jump to preview and then settle-correct without a scrollbar pointer phase', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.scrollTop = 1800
    scrollRoot.dispatchEvent(new Event('scroll'))

    // 中文说明：程序跳转 / editor-scroll 不应该被滚动条拖拽启发式吞掉。
    // 它需要先走 height-cache preview，让窗口尽快靠近目标，再由 settled correction 精确采样。
    expect(scheduleRefresh).toHaveBeenCalledWith({ type: 'scroll', source: 'native' })
    expect(refreshNow).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('cancels pending settled correction and pointer listeners on cleanup', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.scrollTop = 300
    scrollRoot.dispatchEvent(new Event('scroll'))
    tracker.cleanup()

    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    window.dispatchEvent(new MouseEvent('mouseup'))
    scrollRoot.scrollTop = 1200
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).toHaveBeenCalledTimes(1)
    expect(refreshNow).not.toHaveBeenCalled()
  })

  it('ends scrollbar drag on window blur and runs one settled correction afterward', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh: vi.fn(),
    })

    tracker.install()
    scrollRoot.dispatchEvent(new MouseEvent('mousedown', { clientX: 92, clientY: 200 }))
    scrollRoot.scrollTop = 1200
    scrollRoot.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)

    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('suppresses small native scroll echoes after an authoritative correction', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    tracker.updateObservedScrollTop(2400)
    scrollRoot.scrollTop = 2440
    scrollRoot.dispatchEvent(new Event('scroll'))

    // 中文说明：DOM correction 后浏览器可能回放一小段 scroll echo。
    // 这类 echo 不能重新走 height-cache preview，否则会把刚纠偏好的窗口闪回粗估窗口。
    expect(scheduleRefresh).not.toHaveBeenCalled()
    expect(refreshNow).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    expect(refreshNow).toHaveBeenCalledTimes(1)
    expect(refreshNow).toHaveBeenCalledWith({ type: 'scroll', source: 'native', isCorrection: true })
    tracker.cleanup()
  })

  it('ignores unchanged scroll events without rescheduling correction work', () => {
    const scrollRoot = document.createElement('div')
    setElementMetric(scrollRoot, 'clientHeight', 800)
    setElementMetric(scrollRoot, 'scrollHeight', 5000)
    setElementRect(scrollRoot, { left: 0, right: 100, top: 0, bottom: 800 })
    const refreshNow = vi.fn()
    const scheduleRefresh = vi.fn()
    const tracker = createVirtualViewportTracker({
      getScrollRoot: () => scrollRoot,
      nowMs: () => Date.now(),
      refreshNow,
      scheduleRefresh,
    })

    tracker.install()
    scrollRoot.scrollTop = 0
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(scheduleRefresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS + 1)
    expect(refreshNow).not.toHaveBeenCalled()
    tracker.cleanup()
  })
})
