/**
 * MindMap Intent 日志器
 *
 * 中文说明：
 * - 用于 Intent 系统的可观测性
 * - 支持开发环境调试与生产环境诊断
 * - 通过 traceId 串联 intent -> command -> operation
 *
 * @module interaction/intents/intentLogger
 */

import type { Intent, IntentName, IntentHandleResult } from './types'

// ============================================================================
// 日志级别与配置
// ============================================================================

/**
 * 日志级别
 */
export type IntentLogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 日志配置
 */
export interface IntentLoggerConfig {
  /** 是否启用日志 */
  enabled: boolean
  /** 最小日志级别 */
  minLevel: IntentLogLevel
  /** 是否输出 payload 详情 */
  includePayload: boolean
  /** 是否输出时间戳 */
  includeTimestamp: boolean
  /** 自定义日志处理器 */
  customHandler?: (entry: IntentLogEntry) => void
}

/**
 * 日志条目
 */
export interface IntentLogEntry {
  level: IntentLogLevel
  timestamp: number
  traceId: string
  intentName: IntentName
  source: string
  message: string
  payload?: unknown
  result?: IntentHandleResult
  durationMs?: number
  error?: Error
}

// ============================================================================
// 默认配置
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<IntentLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const DEFAULT_CONFIG: IntentLoggerConfig = {
  // 中文说明：
  // - Intent 日志在滚轮平移/拖拽等高频意图下会非常吵（例如 canvas:pan）
  // - 默认策略：开发态也仅输出 warn/error（保留“未处理/异常”的可观测性），需要时再手动调低 minLevel
  enabled: import.meta.env.DEV,
  minLevel: 'warn',
  includePayload: false,
  includeTimestamp: true,
}

// ============================================================================
// IntentLogger 类
// ============================================================================

/**
 * Intent 日志器
 *
 * 中文说明：
 * - 单例模式，通过 getIntentLogger() 获取
 * - 支持配置热更新
 * - 输出格式：[MindMapIntent] traceId=... intentName=... source=...
 */
class IntentLogger {
  private config: IntentLoggerConfig
  private pendingIntents: Map<string, { intent: Intent; startTime: number }> = new Map()

  constructor(config: Partial<IntentLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  configure(config: Partial<IntentLoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.config.enabled = true
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.config.enabled = false
  }

  /**
   * 检查是否应该输出该级别的日志
   */
  private shouldLog(level: IntentLogLevel): boolean {
    if (!this.config.enabled) return false
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel]
  }

  /**
   * 格式化日志前缀
   */
  private formatPrefix(entry: IntentLogEntry): string {
    const parts = ['[MindMapIntent]']

    if (this.config.includeTimestamp) {
      parts.push(new Date(entry.timestamp).toISOString().slice(11, 23))
    }

    parts.push(`traceId=${entry.traceId.slice(0, 20)}...`)
    parts.push(`intent=${entry.intentName}`)
    parts.push(`source=${entry.source}`)

    if (entry.durationMs !== undefined) {
      parts.push(`duration=${entry.durationMs}ms`)
    }

    return parts.join(' ')
  }

  /**
   * 输出日志
   */
  private output(entry: IntentLogEntry): void {
    if (this.config.customHandler) {
      this.config.customHandler(entry)
      return
    }

    const prefix = this.formatPrefix(entry)
    const message = entry.message ? `: ${entry.message}` : ''
    const fullMessage = `${prefix}${message}`

    switch (entry.level) {
      case 'debug':
        if (this.config.includePayload && entry.payload) {
          console.debug(fullMessage, { payload: entry.payload, result: entry.result })
        } else {
          console.debug(fullMessage)
        }
        break
      case 'info':
        if (this.config.includePayload && entry.payload) {
          console.info(fullMessage, { payload: entry.payload, result: entry.result })
        } else {
          console.info(fullMessage)
        }
        break
      case 'warn':
        console.warn(fullMessage, { payload: entry.payload, result: entry.result })
        break
      case 'error':
        console.error(fullMessage, { payload: entry.payload, error: entry.error })
        break
    }
  }

  /**
   * 记录意图创建
   */
  intentCreated(intent: Intent): void {
    if (!this.shouldLog('debug')) return

    this.pendingIntents.set(intent.meta.traceId, {
      intent,
      startTime: performance.now(),
    })

    this.output({
      level: 'debug',
      timestamp: intent.meta.timestamp,
      traceId: intent.meta.traceId,
      intentName: intent.name,
      source: intent.meta.source,
      message: 'created',
      payload: intent.payload,
    })
  }

  /**
   * 记录意图派发开始
   */
  intentDispatching(intent: Intent): void {
    if (!this.shouldLog('debug')) return

    // 如果没有记录创建时间，则记录派发时间作为开始时间
    if (!this.pendingIntents.has(intent.meta.traceId)) {
      this.pendingIntents.set(intent.meta.traceId, {
        intent,
        startTime: performance.now(),
      })
    }

    this.output({
      level: 'debug',
      timestamp: Date.now(),
      traceId: intent.meta.traceId,
      intentName: intent.name,
      source: intent.meta.source,
      message: 'dispatching',
      payload: intent.payload,
    })
  }

  /**
   * 记录意图处理完成
   */
  intentHandled(intent: Intent, result: IntentHandleResult): void {
    const pending = this.pendingIntents.get(intent.meta.traceId)
    const durationMs = pending ? Math.round(performance.now() - pending.startTime) : undefined

    this.pendingIntents.delete(intent.meta.traceId)

    const level: IntentLogLevel = result.handled ? 'info' : 'warn'
    if (!this.shouldLog(level)) return

    const message = result.handled
      ? `handled${result.commandResult ? ` (cmd: ${result.commandResult.ok ? 'ok' : 'failed'})` : ''}`
      : `not handled${result.reason ? `: ${result.reason}` : ''}`

    this.output({
      level,
      timestamp: Date.now(),
      traceId: intent.meta.traceId,
      intentName: intent.name,
      source: intent.meta.source,
      message,
      payload: intent.payload,
      result,
      durationMs,
    })
  }

  /**
   * 记录意图处理错误
   */
  intentError(intent: Intent, error: Error): void {
    const pending = this.pendingIntents.get(intent.meta.traceId)
    const durationMs = pending ? Math.round(performance.now() - pending.startTime) : undefined

    this.pendingIntents.delete(intent.meta.traceId)

    if (!this.shouldLog('error')) return

    this.output({
      level: 'error',
      timestamp: Date.now(),
      traceId: intent.meta.traceId,
      intentName: intent.name,
      source: intent.meta.source,
      message: `error: ${error.message}`,
      payload: intent.payload,
      durationMs,
      error,
    })
  }

  /**
   * 记录通用信息
   */
  info(traceId: string, intentName: IntentName, source: string, message: string): void {
    if (!this.shouldLog('info')) return

    this.output({
      level: 'info',
      timestamp: Date.now(),
      traceId,
      intentName,
      source,
      message,
    })
  }

  /**
   * 记录警告
   */
  warn(traceId: string, intentName: IntentName, source: string, message: string): void {
    if (!this.shouldLog('warn')) return

    this.output({
      level: 'warn',
      timestamp: Date.now(),
      traceId,
      intentName,
      source,
      message,
    })
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let loggerInstance: IntentLogger | null = null

/**
 * 获取 Intent 日志器单例
 */
export function getIntentLogger(): IntentLogger {
  if (!loggerInstance) {
    loggerInstance = new IntentLogger()
  }
  return loggerInstance
}

/**
 * 配置 Intent 日志器
 */
export function configureIntentLogger(config: Partial<IntentLoggerConfig>): void {
  getIntentLogger().configure(config)
}
