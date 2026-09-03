/**
 * MindMap 命令体系 — 结构化日志
 *
 * 中文说明：
 * - 提供命令执行的结构化日志输出
 * - 支持开关控制（避免生产环境刷屏）
 * - 失败必须输出足够定位根因的上下文
 *
 * @module domain/commands/internal/commandLogger
 */

import type { CommandContext, CommandResult, CommandFailReason } from '../types'

// ============================================================================
// 配置
// ============================================================================

/**
 * 日志配置
 */
export interface CommandLoggerConfig {
  /** 是否启用日志（默认 false） */
  enabled: boolean
  /** 是否输出成功日志（默认 true，仅在 enabled=true 时生效） */
  logSuccess: boolean
  /** 是否输出失败日志（默认 true，始终生效，不受 enabled 控制） */
  logFailure: boolean
}

const defaultConfig: CommandLoggerConfig = {
  enabled: false,
  logSuccess: true,
  logFailure: true,
}

let config: CommandLoggerConfig = { ...defaultConfig }

/**
 * 设置日志配置
 */
export function setCommandLoggerConfig(newConfig: Partial<CommandLoggerConfig>): void {
  config = { ...config, ...newConfig }
}

/**
 * 获取当前日志配置
 */
export function getCommandLoggerConfig(): CommandLoggerConfig {
  return { ...config }
}

// ============================================================================
// 日志输出
// ============================================================================

/**
 * 日志前缀
 */
const LOG_PREFIX = '[MindMapCommand]'

/**
 * 命令开始日志条目
 */
interface CommandStartLogEntry {
  commandName: string
  txId: string
  source: string
  documentId: string | null
  structureRevision: number
  payload: unknown
}

/**
 * 命令结束日志条目
 */
interface CommandEndLogEntry {
  commandName: string
  txId: string
  source: string
  structureRevision: number
  durationMs: number
  result: 'ok' | 'fail'
  reason?: CommandFailReason
  message?: string
}

/**
 * 输出命令开始日志
 */
export function logCommandStart(ctx: CommandContext, payload: unknown): void {
  if (!config.enabled) return

  const entry: CommandStartLogEntry = {
    commandName: ctx.commandName,
    txId: ctx.txId,
    source: ctx.meta.source,
    documentId: ctx.documentId,
    structureRevision: ctx.structureRevision,
    payload: sanitizePayload(payload),
  }

  console.log(`${LOG_PREFIX} start`, entry)
}

/**
 * 输出命令结束日志
 */
export function logCommandEnd(ctx: CommandContext, result: CommandResult): void {
  const durationMs = performance.now() - ctx.startedAt

  const entry: CommandEndLogEntry = {
    commandName: ctx.commandName,
    txId: ctx.txId,
    source: ctx.meta.source,
    structureRevision: ctx.structureRevision,
    durationMs: Math.round(durationMs * 100) / 100, // 保留两位小数
    result: result.ok ? 'ok' : 'fail',
  }

  if (!result.ok) {
    entry.reason = result.reason
    if (result.message) {
      entry.message = result.message
    }
  }

  // 失败日志始终输出（不受 enabled 控制）
  if (!result.ok && config.logFailure) {
    console.warn(`${LOG_PREFIX} fail`, entry)
    return
  }

  // 成功日志受 enabled 和 logSuccess 控制
  if (config.enabled && config.logSuccess) {
    console.log(`${LOG_PREFIX} end`, entry)
  }
}

/**
 * 输出 can 检查失败日志
 *
 * 中文说明：
 * - can 返回 false 时输出，便于排查"为什么命令不可用"
 * - 受 enabled 控制
 */
export function logCanFailed(commandName: string, payload: unknown, reason?: string): void {
  if (!config.enabled) return

  console.log(`${LOG_PREFIX} can:false`, {
    commandName,
    payload: sanitizePayload(payload),
    reason: reason ?? 'guard returned false',
  })
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 清理 payload 用于日志输出
 *
 * 中文说明：
 * - 移除可能的敏感信息或过大对象
 * - 只保留业务字段的预览
 */
function sanitizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload
  }

  if (typeof payload !== 'object') {
    return payload
  }

  // 浅拷贝，避免日志输出影响原对象
  const sanitized: Record<string, unknown> = {}
  const obj = payload as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    // 数组：只保留长度和前几个元素预览
    if (Array.isArray(value)) {
      if (value.length <= 3) {
        sanitized[key] = value
      } else {
        sanitized[key] = {
          __preview: value.slice(0, 3),
          __length: value.length,
        }
      }
      continue
    }

    // 对象：浅层复制
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = '[Object]'
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}
