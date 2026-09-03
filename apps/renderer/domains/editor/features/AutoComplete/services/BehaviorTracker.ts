/**
 * BehaviorTracker - 用户行为追踪服务
 *
 * 职责：
 * - 记录最近一段时间的用户编辑行为事实（不做推断）
 * - 提供行为窗口查询和统计
 * - 自动过期清理
 * - 低开销、高性能
 */

import type {
  BehaviorEvent,
  BehaviorEventType,
  BehaviorWindowConfig,
  BehaviorSummary,
} from '../types/behaviorTracking'
import { DEFAULT_BEHAVIOR_WINDOW_CONFIG } from '../types/behaviorTracking'

export class BehaviorTracker {
  private events: BehaviorEvent[] = []
  private config: Required<BehaviorWindowConfig>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config?: BehaviorWindowConfig) {
    this.config = {
      ...DEFAULT_BEHAVIOR_WINDOW_CONFIG,
      ...config,
    }
    this.startCleanupTimer()
  }

  /**
   * 记录一个行为事件
   */
  addEvent(event: Omit<BehaviorEvent, 'ts'>): void {
    const fullEvent: BehaviorEvent = {
      ...event,
      ts: Date.now(),
    }

    // 截断内容样本
    if (fullEvent.contentSample && fullEvent.contentSample.length > this.config.maxContentSampleLength) {
      fullEvent.contentSample = fullEvent.contentSample.slice(0, this.config.maxContentSampleLength)
    }

    this.events.push(fullEvent)

    // 限制事件数量
    if (this.events.length > this.config.maxEvents) {
      this.events.shift()
    }
  }

  /**
   * 获取时间窗口内的所有事件
   */
  getRecentEvents(windowMs?: number): BehaviorEvent[] {
    const window = windowMs ?? this.config.timeWindowMs
    const now = Date.now()
    const cutoff = now - window

    return this.events.filter((event) => event.ts >= cutoff)
  }

  /**
   * 获取特定类型的事件
   */
  getEventsByType(type: BehaviorEventType, windowMs?: number): BehaviorEvent[] {
    return this.getRecentEvents(windowMs).filter((event) => event.type === type)
  }

  /**
   * 获取行为统计摘要
   */
  getSummary(windowMs?: number): BehaviorSummary {
    const recentEvents = this.getRecentEvents(windowMs)
    const now = Date.now()
    const window = windowMs ?? this.config.timeWindowMs

    const eventCounts: Record<BehaviorEventType, number> = {
      insert: 0,
      delete: 0,
      paste: 0,
      selection_move: 0,
      undo: 0,
      redo: 0,
      accept_suggestion: 0,
    }

    let totalInsertedChars = 0
    let totalDeletedChars = 0
    let lastEventTs: number | null = null

    for (const event of recentEvents) {
      eventCounts[event.type]++

      if (event.deltaChars > 0) {
        totalInsertedChars += event.deltaChars
      } else if (event.deltaChars < 0) {
        totalDeletedChars += Math.abs(event.deltaChars)
      }

      if (lastEventTs === null || event.ts > lastEventTs) {
        lastEventTs = event.ts
      }
    }

    return {
      totalEvents: recentEvents.length,
      eventCounts,
      totalInsertedChars,
      totalDeletedChars,
      lastEventTs,
      windowStartTs: now - window,
      windowEndTs: now,
    }
  }

  /**
   * 获取最近一次事件
   */
  getLastEvent(): BehaviorEvent | null {
    return this.events.length > 0 ? this.events[this.events.length - 1] : null
  }

  /**
   * 获取最近 N 个事件
   */
  getLastNEvents(n: number): BehaviorEvent[] {
    return this.events.slice(-n)
  }

  /**
   * 清理过期事件
   */
  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.config.timeWindowMs

    this.events = this.events.filter((event) => event.ts >= cutoff)
  }

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupIntervalMs)
  }

  /**
   * 停止自动清理定时器
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * 清空所有事件
   */
  clear(): void {
    this.events = []
  }

  /**
   * 销毁追踪器（清理资源）
   */
  destroy(): void {
    this.stopCleanupTimer()
    this.clear()
  }

  /**
   * 获取当前事件数量
   */
  getEventCount(): number {
    return this.events.length
  }

  /**
   * 调试：打印最近的行为统计
   */
  debugPrintSummary(windowMs?: number): void {
    const summary = this.getSummary(windowMs)
    console.group('📊 Behavior Tracker Summary')
    console.log('Total events:', summary.totalEvents)
    console.log('Event counts:', summary.eventCounts)
    console.log('Inserted chars:', summary.totalInsertedChars)
    console.log('Deleted chars:', summary.totalDeletedChars)
    console.log('Last event:', summary.lastEventTs ? new Date(summary.lastEventTs).toLocaleTimeString() : 'None')
    console.log('Window:', {
      start: new Date(summary.windowStartTs).toLocaleTimeString(),
      end: new Date(summary.windowEndTs).toLocaleTimeString(),
    })
    console.groupEnd()
  }

  /**
   * 调试：打印最近的事件列表
   */
  debugPrintEvents(limit = 10, windowMs?: number): void {
    const events = this.getRecentEvents(windowMs).slice(-limit)
    console.group(`📝 Recent ${events.length} Events`)
    events.forEach((event, idx) => {
      const time = new Date(event.ts).toLocaleTimeString()
      const content = event.contentSample ? ` "${event.contentSample}"` : ''
      console.log(
        `${idx + 1}. [${time}] ${event.type} (${event.from}-${event.to}, Δ${event.deltaChars})${content}`
      )
    })
    console.groupEnd()
  }
}

/**
 * 全局单例实例
 */
let globalTrackerInstance: BehaviorTracker | null = null

/**
 * 获取全局 BehaviorTracker 实例
 */
export function getBehaviorTracker(config?: BehaviorWindowConfig): BehaviorTracker {
  if (!globalTrackerInstance) {
    globalTrackerInstance = new BehaviorTracker(config)
  }
  return globalTrackerInstance
}

/**
 * 重置全局 BehaviorTracker 实例
 */
export function resetBehaviorTracker(config?: BehaviorWindowConfig): BehaviorTracker {
  if (globalTrackerInstance) {
    globalTrackerInstance.destroy()
  }
  globalTrackerInstance = new BehaviorTracker(config)
  return globalTrackerInstance
}

/**
 * 销毁全局 BehaviorTracker 实例
 */
export function destroyBehaviorTracker(): void {
  if (globalTrackerInstance) {
    globalTrackerInstance.destroy()
    globalTrackerInstance = null
  }
}
