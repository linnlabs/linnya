/**
 * MindMap 命令体系 — 上下文管理
 *
 * 中文说明：
 * - 管理命令执行期间的 activeCommandContext
 * - 使用 stack 结构，支持未来 chain/嵌套命令
 * - 用于 operation/reflow 的 txId 关联
 *
 * @module domain/commands/internal/commandContext
 */

import type { MindMapInstance } from '../../types'
import type { CommandContext, CommandMeta, CommandSource } from '../types'

// ============================================================================
// txId 生成
// ============================================================================

let txIdCounter = 0

/**
 * 生成唯一的事务 ID
 *
 * 中文说明：
 * - 格式：cmd_{timestamp}_{counter}
 * - 保证同一毫秒内也不会重复
 */
export function generateTxId(): string {
  txIdCounter += 1
  return `cmd_${Date.now()}_${txIdCounter}`
}

// ============================================================================
// CommandContextManager — 上下文管理器
// ============================================================================

/**
 * 命令上下文管理器
 *
 * 中文说明：
 * - 挂载到 MindMapInstance 的内部字段
 * - 使用 stack 结构，支持 chain/嵌套命令场景
 * - 提供 push/pop/current 操作
 */
export class CommandContextManager {
  /** 上下文栈 */
  private stack: CommandContext[] = []

  /** 获取当前活动的命令上下文（栈顶） */
  get current(): CommandContext | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null
  }

  /** 是否有活动的命令上下文 */
  get hasActive(): boolean {
    return this.stack.length > 0
  }

  /**
   * 创建并压入新的命令上下文
   *
   * @param commandName 命令名称
   * @param meta 命令元信息
   * @param mind MindMap 实例
   * @returns 新创建的上下文
   */
  push(commandName: string, meta: CommandMeta, mind: MindMapInstance): CommandContext {
    const ctx: CommandContext = {
      commandName,
      txId: generateTxId(),
      documentId: mind.documentId,
      structureRevision: mind.structureRevision,
      startedAt: performance.now(),
      meta,
    }
    this.stack.push(ctx)
    return ctx
  }

  /**
   * 弹出当前命令上下文
   *
   * 中文说明：
   * - 必须在命令执行结束时调用（包括异常情况）
   * - 返回弹出的上下文，用于日志输出
   */
  pop(): CommandContext | null {
    return this.stack.pop() ?? null
  }

  /**
   * 清空所有上下文（用于紧急恢复/dispose）
   */
  clear(): void {
    this.stack.length = 0
  }

  /**
   * 获取当前所有活动的 txId 集合
   *
   * 中文说明：
   * - 用于 ReflowScheduler 记录"本帧有哪些命令触发了 reflow"
   */
  getActiveTxIds(): string[] {
    return this.stack.map((ctx) => ctx.txId)
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 填充默认 meta
 *
 * 中文说明：
 * - 外部调用时 meta 的部分字段可选
 * - 这里补齐 source 的默认值
 */
export function fillDefaultMeta(partial?: Partial<CommandMeta>): CommandMeta {
  return {
    source: partial?.source ?? 'unknown',
    traceId: partial?.traceId,
    timestamp: partial?.timestamp ?? Date.now(),
    internal: partial?.internal,
    addToHistory: partial?.addToHistory,
    userNotification: partial?.userNotification,
  }
}

/**
 * 内部字段名（挂载到 mind 实例）
 *
 * 中文说明：
 * - 使用 Symbol 避免与其他字段冲突
 * - 外部不应直接访问
 */
export const COMMAND_CONTEXT_MANAGER_KEY = Symbol('__commandContextManager__')
