/**
 * viewportTracker.ts
 *
 * RootBlock 虚拟化的滚动输入层。
 *
 * 中文说明：
 * - 这里只监听 scroll，并把滚动形态转成 typed reason；
 * - 是否 hydrate 哪些 block 由 Engine + renderWindowMath 决定；
 * - 所有滚动输入都交给 Engine rAF 合批，避免在 passive scroll 回调里同步跑 10k 级窗口计算。
 */

import type { RenderVirtualizationRefreshReason } from './refreshReason'
import {
  DOM_CORRECTION_REFRESH_THROTTLE_MS,
  IMMEDIATE_SCROLL_REFRESH_THROTTLE_MS,
  MIN_DOM_CORRECTION_SCROLL_DISTANCE_PX,
  MIN_IMMEDIATE_SCROLL_JUMP_PX,
  SCROLL_SETTLE_CORRECTION_MS,
} from '../renderVirtualizationConstants'
import { publishViewportTrackerPerf } from '../debug/viewportTrackerPerf'

export interface VirtualViewportTracker {
  install: () => void
  cleanup: () => void
  updateObservedScrollTop: (scrollTop: number) => void
}

export interface VirtualViewportTrackerOptions {
  getScrollRoot: () => HTMLElement | null
  nowMs: () => number
  refreshNow: (reason: RenderVirtualizationRefreshReason) => void
  scheduleRefresh: (reason: RenderVirtualizationRefreshReason) => void
}

const SCROLLBAR_HIT_TARGET_PX = 24

export function getScrollJumpThreshold(scrollRoot: HTMLElement | null): number {
  return Math.max(
    MIN_IMMEDIATE_SCROLL_JUMP_PX,
    (scrollRoot?.clientHeight ?? 0) * 1.5
  )
}

export function getDomCorrectionScrollDistance(scrollRoot: HTMLElement | null): number {
  return Math.max(
    MIN_DOM_CORRECTION_SCROLL_DISTANCE_PX,
    (scrollRoot?.clientHeight ?? 0) * 3
  )
}

export function createVirtualViewportTracker(
  options: VirtualViewportTrackerOptions
): VirtualViewportTracker {
  let removeScrollListener: (() => void) | null = null
  let removePointerListeners: (() => void) | null = null
  let lastObservedScrollTop: number | null = null
  let lastImmediateScrollRefreshAt = Number.NEGATIVE_INFINITY
  let lastDomCorrectionScrollTop: number | null = null
  let lastDomCorrectionRefreshAt = Number.NEGATIVE_INFINITY
  let hasAuthoritativeCorrection = false
  let settleCorrectionTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let isScrollbarDragActive = false

  function isLikelyVerticalScrollbarPointerDown(event: MouseEvent, scrollRoot: HTMLElement): boolean {
    const rect = scrollRoot.getBoundingClientRect()
    const hasScrollableOverflow = scrollRoot.scrollHeight - scrollRoot.clientHeight > 1
    if (!hasScrollableOverflow) return false

    const insideVerticalRange = event.clientY >= rect.top && event.clientY <= rect.bottom
    const nearRightScrollbar = event.clientX >= rect.right - SCROLLBAR_HIT_TARGET_PX && event.clientX <= rect.right + 2
    return insideVerticalRange && nearRightScrollbar
  }

  function endScrollbarDrag(scrollRoot: HTMLElement): void {
    if (!isScrollbarDragActive) return
    isScrollbarDragActive = false
    publishViewportTrackerPerf({
      decision: 'scrollbar-drag-ended',
      scrollTop: scrollRoot.scrollTop,
      timestamp: options.nowMs(),
    })
    scheduleSettledCorrection(scrollRoot)
  }

  function installPointerListeners(scrollRoot: HTMLElement): void {
    if (removePointerListeners) return

    const startScrollbarDrag = (event: Event): void => {
      if (!(event instanceof MouseEvent)) return
      if (!isLikelyVerticalScrollbarPointerDown(event, scrollRoot)) return
      isScrollbarDragActive = true
      publishViewportTrackerPerf({
        decision: 'scrollbar-drag-started',
        scrollTop: scrollRoot.scrollTop,
        timestamp: options.nowMs(),
      })
    }
    const stopScrollbarDrag = (): void => {
      endScrollbarDrag(scrollRoot)
    }

    scrollRoot.addEventListener('pointerdown', startScrollbarDrag)
    scrollRoot.addEventListener('mousedown', startScrollbarDrag)
    window.addEventListener('pointerup', stopScrollbarDrag)
    window.addEventListener('mouseup', stopScrollbarDrag)
    window.addEventListener('blur', stopScrollbarDrag)
    removePointerListeners = () => {
      scrollRoot.removeEventListener('pointerdown', startScrollbarDrag)
      scrollRoot.removeEventListener('mousedown', startScrollbarDrag)
      window.removeEventListener('pointerup', stopScrollbarDrag)
      window.removeEventListener('mouseup', stopScrollbarDrag)
      window.removeEventListener('blur', stopScrollbarDrag)
      isScrollbarDragActive = false
    }
  }

  function clearSettledCorrectionTimer(): void {
    if (settleCorrectionTimer === null) return
    globalThis.clearTimeout(settleCorrectionTimer)
    settleCorrectionTimer = null
    publishViewportTrackerPerf({
      decision: 'settled-correction-cleared',
      timestamp: options.nowMs(),
    })
  }

  function scheduleSettledCorrection(scrollRoot: HTMLElement): void {
    clearSettledCorrectionTimer()
    settleCorrectionTimer = globalThis.setTimeout(() => {
      settleCorrectionTimer = null
      if (isScrollbarDragActive) {
        publishViewportTrackerPerf({
          decision: 'scrollbar-drag-settle-deferred',
          scrollTop: scrollRoot.scrollTop,
          timerDelayMs: SCROLL_SETTLE_CORRECTION_MS,
          timestamp: options.nowMs(),
        })
        scheduleSettledCorrection(scrollRoot)
        return
      }
      const nextScrollTop = scrollRoot.scrollTop
      lastObservedScrollTop = nextScrollTop
      lastDomCorrectionScrollTop = nextScrollTop
      lastDomCorrectionRefreshAt = options.nowMs()
      hasAuthoritativeCorrection = true
      publishViewportTrackerPerf({
        decision: 'settled-correction-fired',
        scrollTop: nextScrollTop,
        lastDomCorrectionScrollTop,
        timestamp: lastDomCorrectionRefreshAt,
      })
      options.refreshNow({ type: 'scroll', source: 'native', isCorrection: true })
    }, SCROLL_SETTLE_CORRECTION_MS)
    publishViewportTrackerPerf({
      decision: 'settled-correction-scheduled',
      scrollTop: scrollRoot.scrollTop,
      timerDelayMs: SCROLL_SETTLE_CORRECTION_MS,
      timestamp: options.nowMs(),
    })
  }

  function install(): void {
    if (removeScrollListener) return
    const scrollRoot = options.getScrollRoot()
    if (!scrollRoot) {
      publishViewportTrackerPerf({
        decision: 'install-missing-root',
        timestamp: options.nowMs(),
      })
      return
    }
    lastObservedScrollTop = scrollRoot.scrollTop
    lastDomCorrectionScrollTop = scrollRoot.scrollTop
    hasAuthoritativeCorrection = false
    publishViewportTrackerPerf({
      decision: 'install',
      scrollTop: scrollRoot.scrollTop,
      timestamp: options.nowMs(),
    })
    installPointerListeners(scrollRoot)

    const onScroll = (): void => {
      const nextScrollTop = scrollRoot.scrollTop
      const previousScrollTop = lastObservedScrollTop
      lastObservedScrollTop = nextScrollTop

      if (previousScrollTop === null) {
        scheduleSettledCorrection(scrollRoot)
        publishViewportTrackerPerf({
          decision: 'scroll-scheduled',
          scrollTop: nextScrollTop,
          previousScrollTop,
          timestamp: options.nowMs(),
        })
        options.scheduleRefresh({ type: 'scroll', source: 'native' })
        return
      }

      const delta = Math.abs(nextScrollTop - previousScrollTop)
      const jumpThreshold = getScrollJumpThreshold(scrollRoot)
      const correctionDistance = getDomCorrectionScrollDistance(scrollRoot)
      const correctionDelta = Math.abs(nextScrollTop - (lastDomCorrectionScrollTop ?? previousScrollTop))
      const now = options.nowMs()

      if (delta < 1) {
        publishViewportTrackerPerf({
          decision: 'scroll-unchanged-ignored',
          scrollTop: nextScrollTop,
          previousScrollTop,
          delta,
          correctionDelta,
          lastDomCorrectionScrollTop,
          timestamp: now,
        })
        return
      }

      if (isScrollbarDragActive) {
        scheduleSettledCorrection(scrollRoot)
        publishViewportTrackerPerf({
          decision: 'scrollbar-drag-preview-suppressed',
          scrollTop: nextScrollTop,
          previousScrollTop,
          delta,
          jumpThreshold,
          correctionDelta,
          correctionDistance,
          lastDomCorrectionScrollTop,
          timestamp: now,
        })
        // 中文说明：按住原生滚动条拖拽时，任何 hydrate/dehydrate 都可能改变 scrollHeight，
        // 导致浏览器把滚动条拇指重新映射到鼠标下方或上方。拖拽期间只记录 scrollTop，
        // 松手后再由 settled correction 一次性水合当前视口。
        return
      }

      if (
        delta >= jumpThreshold &&
        now - lastImmediateScrollRefreshAt >= IMMEDIATE_SCROLL_REFRESH_THROTTLE_MS
      ) {
        lastImmediateScrollRefreshAt = now
        lastDomCorrectionScrollTop = nextScrollTop
        lastDomCorrectionRefreshAt = now
        hasAuthoritativeCorrection = false
        scheduleSettledCorrection(scrollRoot)
        publishViewportTrackerPerf({
          decision: 'scroll-jump-preview',
          scrollTop: nextScrollTop,
          previousScrollTop,
          delta,
          jumpThreshold,
          correctionDelta,
          correctionDistance,
          lastDomCorrectionScrollTop,
          timestamp: now,
        })
        // 中文说明：拖动原生滚动条时会连续产生大跳跃。拖动中只做 height-cache 预览，
        // 精确 DOM sample 交给停止后的 settled correction，避免滚动条被 hydrate 重活拖住。
        options.scheduleRefresh({ type: 'scroll', source: 'native' })
        return
      }

      if (
        correctionDelta >= correctionDistance &&
        now - lastDomCorrectionRefreshAt >= DOM_CORRECTION_REFRESH_THROTTLE_MS
      ) {
        lastDomCorrectionScrollTop = nextScrollTop
        lastDomCorrectionRefreshAt = now
        hasAuthoritativeCorrection = false
        scheduleSettledCorrection(scrollRoot)
        publishViewportTrackerPerf({
          decision: 'scroll-correction-preview',
          scrollTop: nextScrollTop,
          previousScrollTop,
          delta,
          jumpThreshold,
          correctionDelta,
          correctionDistance,
          lastDomCorrectionScrollTop,
          timestamp: now,
        })
        // 中文说明：拖拽过程中的累计漂移也只做预览，停止后再用 DOM sample 精确纠偏。
        options.scheduleRefresh({ type: 'scroll', source: 'native' })
        return
      }

      if (hasAuthoritativeCorrection) {
        scheduleSettledCorrection(scrollRoot)
        publishViewportTrackerPerf({
          decision: 'post-correction-preview-suppressed',
          scrollTop: nextScrollTop,
          previousScrollTop,
          delta,
          jumpThreshold,
          correctionDelta,
          correctionDistance,
          lastDomCorrectionScrollTop,
          timestamp: now,
        })
        // 中文说明：DOM sample correction 产出的窗口是当前滚动位置的权威窗口。
        // 近距离原生 scroll 回声只安排下一次稳定纠偏，不能再用 height-cache 预览
        // 把刚水合好的 220 块窗口缩回 58 块，否则会出现空白/正常状态闪烁。
        return
      }

      scheduleSettledCorrection(scrollRoot)
      publishViewportTrackerPerf({
        decision: 'scroll-scheduled',
        scrollTop: nextScrollTop,
        previousScrollTop,
        delta,
        jumpThreshold,
        correctionDelta,
        correctionDistance,
        lastDomCorrectionScrollTop,
        timestamp: now,
      })
      options.scheduleRefresh({ type: 'scroll', source: 'native' })
    }
    scrollRoot.addEventListener('scroll', onScroll, { passive: true })
    removeScrollListener = () => {
      scrollRoot.removeEventListener('scroll', onScroll)
      clearSettledCorrectionTimer()
      removePointerListeners?.()
      removePointerListeners = null
      lastObservedScrollTop = null
      lastDomCorrectionScrollTop = null
      hasAuthoritativeCorrection = false
      publishViewportTrackerPerf({
        decision: 'cleanup',
        timestamp: options.nowMs(),
      })
    }
  }

  return {
    install,
    cleanup() {
      removeScrollListener?.()
      removeScrollListener = null
    },
    updateObservedScrollTop(scrollTop) {
      clearSettledCorrectionTimer()
      lastObservedScrollTop = scrollTop
      lastDomCorrectionScrollTop = scrollTop
      lastDomCorrectionRefreshAt = options.nowMs()
      hasAuthoritativeCorrection = true
      publishViewportTrackerPerf({
        decision: 'observed-scrolltop-updated',
        scrollTop,
        lastDomCorrectionScrollTop,
        timestamp: lastDomCorrectionRefreshAt,
      })
    },
  }
}
