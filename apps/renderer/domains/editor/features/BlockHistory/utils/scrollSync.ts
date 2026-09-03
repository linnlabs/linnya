/**
 * @file scrollSync.ts
 * @description 滚动同步工具
 *
 * 用于时光机左右分栏视图的滚动同步
 * 支持基于比例同步和基于行对齐同步两种模式
 */

// ==================== 类型定义 ====================

/** 同步模式 */
export type ScrollSyncMode = 'proportional' | 'line-based'

/** 同步配置 */
export interface ScrollSyncOptions {
  /** 同步模式 */
  mode?: ScrollSyncMode
  /** 防抖延迟（毫秒） */
  debounceMs?: number
  /** 是否启用平滑滚动 */
  smooth?: boolean
}

/** 滚动同步器实例 */
export interface ScrollSyncer {
  /** 销毁同步器 */
  destroy: () => void
  /** 暂停同步 */
  pause: () => void
  /** 恢复同步 */
  resume: () => void
  /** 是否暂停 */
  isPaused: () => boolean
}

// ==================== 实现 ====================

/**
 * 创建滚动同步器
 *
 * @param leftElement - 左侧滚动元素
 * @param rightElement - 右侧滚动元素
 * @param options - 配置选项
 * @returns 同步器实例
 */
export function createScrollSyncer(
  leftElement: HTMLElement,
  rightElement: HTMLElement,
  options: ScrollSyncOptions = {}
): ScrollSyncer {
  const { mode = 'proportional', debounceMs = 0, smooth = false } = options

  let paused = false
  let isSyncing = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 根据比例同步滚动
   */
  function syncByProportional(source: HTMLElement, target: HTMLElement): void {
    const sourceScrollRatio =
      source.scrollTop / (source.scrollHeight - source.clientHeight || 1)

    const targetScrollTop =
      sourceScrollRatio * (target.scrollHeight - target.clientHeight)

    if (smooth) {
      target.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      })
    } else {
      target.scrollTop = targetScrollTop
    }
  }

  /**
   * 同步滚动（简单模式：直接同步 scrollTop）
   */
  function syncScrollTop(source: HTMLElement, target: HTMLElement): void {
    if (smooth) {
      target.scrollTo({
        top: source.scrollTop,
        behavior: 'smooth',
      })
    } else {
      target.scrollTop = source.scrollTop
    }
  }

  /**
   * 执行同步
   */
  function doSync(source: HTMLElement, target: HTMLElement): void {
    if (paused || isSyncing) return

    isSyncing = true

    if (mode === 'proportional') {
      syncByProportional(source, target)
    } else {
      syncScrollTop(source, target)
    }

    // 使用 requestAnimationFrame 来重置 isSyncing
    // 这样可以确保在浏览器完成渲染后才允许下一次同步
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isSyncing = false
      })
    })
  }

  /**
   * 创建带防抖的同步函数
   */
  function createDebouncedSync(source: HTMLElement, target: HTMLElement): () => void {
    return () => {
      if (debounceMs > 0) {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
        }
        debounceTimer = setTimeout(() => {
          doSync(source, target)
        }, debounceMs)
      } else {
        doSync(source, target)
      }
    }
  }

  // 创建事件处理函数
  const handleLeftScroll = createDebouncedSync(leftElement, rightElement)
  const handleRightScroll = createDebouncedSync(rightElement, leftElement)

  // 添加事件监听
  leftElement.addEventListener('scroll', handleLeftScroll, { passive: true })
  rightElement.addEventListener('scroll', handleRightScroll, { passive: true })

  return {
    destroy() {
      leftElement.removeEventListener('scroll', handleLeftScroll)
      rightElement.removeEventListener('scroll', handleRightScroll)
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
    },
    pause() {
      paused = true
    },
    resume() {
      paused = false
    },
    isPaused() {
      return paused
    },
  }
}

/**
 * Vue Composable: 使用滚动同步
 *
 * @param leftRef - 左侧元素的 ref
 * @param rightRef - 右侧元素的 ref
 * @param options - 配置选项
 */
export function useScrollSync(
  leftRef: { value: HTMLElement | null },
  rightRef: { value: HTMLElement | null },
  options: ScrollSyncOptions = {}
): {
  init: () => void
  destroy: () => void
  pause: () => void
  resume: () => void
} {
  let syncer: ScrollSyncer | null = null

  return {
    init() {
      if (leftRef.value && rightRef.value) {
        syncer = createScrollSyncer(leftRef.value, rightRef.value, options)
      }
    },
    destroy() {
      syncer?.destroy()
      syncer = null
    },
    pause() {
      syncer?.pause()
    },
    resume() {
      syncer?.resume()
    },
  }
}

/**
 * 滚动元素到可视区域
 *
 * @param container - 滚动容器
 * @param target - 目标元素
 * @param options - 配置选项
 */
export function scrollIntoViewIfNeeded(
  container: HTMLElement,
  target: HTMLElement,
  options: { padding?: number; behavior?: ScrollBehavior } = {}
): void {
  const { padding = 20, behavior = 'smooth' } = options

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()

  // 计算目标元素相对于容器的位置
  const relativeTop = targetRect.top - containerRect.top + container.scrollTop
  const relativeBottom = relativeTop + targetRect.height

  const visibleTop = container.scrollTop
  const visibleBottom = container.scrollTop + containerRect.height

  // 检查是否需要滚动
  if (relativeTop < visibleTop + padding) {
    // 目标在可视区域上方
    container.scrollTo({
      top: relativeTop - padding,
      behavior,
    })
  } else if (relativeBottom > visibleBottom - padding) {
    // 目标在可视区域下方
    container.scrollTo({
      top: relativeBottom - containerRect.height + padding,
      behavior,
    })
  }
}

/**
 * 计算两个滚动容器的滚动比例差异
 *
 * @param left - 左侧容器
 * @param right - 右侧容器
 * @returns 比例差异（0-1）
 */
export function getScrollRatioDiff(left: HTMLElement, right: HTMLElement): number {
  const leftRatio = left.scrollTop / (left.scrollHeight - left.clientHeight || 1)
  const rightRatio = right.scrollTop / (right.scrollHeight - right.clientHeight || 1)
  return Math.abs(leftRatio - rightRatio)
}


