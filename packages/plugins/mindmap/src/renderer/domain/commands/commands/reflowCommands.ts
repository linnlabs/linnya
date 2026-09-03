/**
 * MindMap 命令体系 — 重算相关命令
 *
 * 中文说明：
 * - reflow.request / reflow.flushNow
 * - 封装 ReflowScheduler，强化 contracts 约束
 * - flushNow 仅允许白名单 reason
 *
 * @module domain/commands/commands/reflowCommands
 */

import type { MindMapInstance } from '../../types'
import type { CommandDef, CommandContext, CommandResult } from '../types'
// guards 暂未使用，reflow 命令有独立的校验逻辑
import type { ReflowReason } from '../../../shared/utils/reflow'

// ============================================================================
// Payload 类型
// ============================================================================

export interface ReflowRequestPayload {
  reason: ReflowReason
}

/**
 * flushNow 仅允许的 reason 白名单
 *
 * 中文说明：
 * - 强时序重算是高风险操作，只有内核流程才允许使用
 * - 限制 reason 可以防止滥用
 */
export type FlushNowReason = 'core:init' | 'core:refresh'

export interface ReflowFlushNowPayload {
  reason: FlushNowReason
}

// ============================================================================
// 白名单校验
// ============================================================================

const FLUSH_NOW_WHITELIST: Set<string> = new Set(['core:init', 'core:refresh'])

function isValidFlushNowReason(reason: string): reason is FlushNowReason {
  return FLUSH_NOW_WHITELIST.has(reason)
}

// ============================================================================
// reflow.request — 请求重算（合并同帧）
// ============================================================================

export const reflowRequestCommand: CommandDef<ReflowRequestPayload> = {
  name: 'reflow.request',

  can(mind: MindMapInstance, payload: ReflowRequestPayload): boolean {
    // reflow 不强依赖 documentId（结构可能在文档加载前就需要重算）
    // 但需要 reflowScheduler 已安装
    if (!mind.reflowScheduler) {
      return false
    }
    if (!payload?.reason || typeof payload.reason !== 'string') {
      return false
    }
    return true
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: ReflowRequestPayload): CommandResult {
    if (!mind.reflowScheduler) {
      return { ok: false, txId: ctx.txId, reason: 'internalError', message: 'ReflowScheduler not installed' }
    }

    if (!payload?.reason || typeof payload.reason !== 'string') {
      return { ok: false, txId: ctx.txId, reason: 'invalidPayload', message: 'Invalid reflow reason' }
    }

    // 调用现有方法
    mind.requestReflow(payload.reason)

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// reflow.flushNow — 强时序立即重算（白名单）
// ============================================================================

export const reflowFlushNowCommand: CommandDef<ReflowFlushNowPayload> = {
  name: 'reflow.flushNow',

  can(mind: MindMapInstance, payload: ReflowFlushNowPayload): boolean {
    if (!mind.reflowScheduler) {
      return false
    }
    if (!payload?.reason || !isValidFlushNowReason(payload.reason)) {
      return false
    }
    return true
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: ReflowFlushNowPayload): CommandResult {
    if (!mind.reflowScheduler) {
      return { ok: false, txId: ctx.txId, reason: 'internalError', message: 'ReflowScheduler not installed' }
    }

    if (!payload?.reason) {
      return { ok: false, txId: ctx.txId, reason: 'invalidPayload', message: 'Missing reflow reason' }
    }

    if (!isValidFlushNowReason(payload.reason)) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'forbidden',
        message: `flushNow only allows whitelist reasons: ${Array.from(FLUSH_NOW_WHITELIST).join(', ')}`,
      }
    }

    // 调用现有方法
    mind.requestReflowNow(payload.reason)

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// 导出所有命令
// ============================================================================

export const reflowCommands = [
  reflowRequestCommand,
  reflowFlushNowCommand,
] as const
