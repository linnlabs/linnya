/**
 * MindMap 命令体系 — 命令注册表与 Runner
 *
 * 中文说明：
 * - 提供命令注册、执行、can 检查的核心能力
 * - 管理 activeCommandContext 的生命周期
 * - 生成 commands/can/runCommand API 挂载到 mind 实例
 *
 * @module domain/commands/registry
 */

import type { MindMapInstance } from '../types'
import type {
  CommandName,
  CommandMeta,
  CommandResult,
  CommandDef,
  MindMapCommands,
  MindMapCan,
  RunCommand,
} from './types'
import {
  CommandContextManager,
  fillDefaultMeta,
  COMMAND_CONTEXT_MANAGER_KEY,
} from './internal/commandContext'
import { logCommandStart, logCommandEnd, logCanFailed, setCommandLoggerConfig } from './internal/commandLogger'
import { registerAllCommands } from './commands'

// ============================================================================
// 命令注册表
// ============================================================================

/**
 * 命令注册表
 *
 * 中文说明：
 * - 存储所有已注册的命令定义
 * - 按命令名索引
 */
const commandRegistry = new Map<CommandName, CommandDef<unknown>>()

/**
 * 注册命令
 *
 * 中文说明：
 * - 在 installMindMapCommands 之前调用
 * - 或在 feature 安装时动态注册
 */
export function registerCommand<P>(def: CommandDef<P>): void {
  commandRegistry.set(def.name, def as CommandDef<unknown>)
}

/**
 * 获取命令定义
 */
export function getCommandDef(name: CommandName): CommandDef<unknown> | undefined {
  return commandRegistry.get(name)
}

/**
 * 检查命令是否已注册
 */
export function hasCommand(name: CommandName): boolean {
  return commandRegistry.has(name)
}

// ============================================================================
// Runner 核心
// ============================================================================

/**
 * 创建命令执行器
 *
 * 中文说明：
 * - 绑定到特定的 mind 实例
 * - 管理 ctx 生命周期（push/pop）
 * - 生成结构化日志
 */
function createCommandRunner(mind: MindMapInstance): RunCommand {
  const ctxManager = getContextManager(mind)

  return function runCommand<P>(
    name: CommandName,
    payload: P,
    partialMeta?: Partial<CommandMeta>
  ): CommandResult {
    const def = getCommandDef(name)

    // 命令未注册
    if (!def) {
      const txId = `unregistered_${Date.now()}`
      console.error(`[MindMapCommand] Command not registered: ${name}`)
      return { ok: false, txId, reason: 'internalError', message: `Command not registered: ${name}` }
    }

    const meta = fillDefaultMeta(partialMeta)
    const ctx = ctxManager.push(name, meta, mind)

    // 输出开始日志
    logCommandStart(ctx, payload)

    let result: CommandResult

    try {
      // 执行命令
      result = def.run(ctx, mind, payload)
    } catch (error) {
      // 捕获内部错误，确保不会因为命令报错导致系统崩溃
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[MindMapCommand] Internal error in command ${name}:`, error)
      result = { ok: false, txId: ctx.txId, reason: 'internalError', message: errorMessage }
    } finally {
      // 无论成功失败都要 pop ctx（try/finally 确保不泄漏）
      ctxManager.pop()
    }

    // 输出结束日志
    logCommandEnd(ctx, result)

    return result
  }
}

/**
 * 创建 can 检查器
 *
 * 中文说明：
 * - 纯检查，不产生副作用
 * - 不会 push/pop ctx
 */
function createCanChecker(mind: MindMapInstance) {
  return function canCommand<P>(name: CommandName, payload: P): boolean {
    const def = getCommandDef(name)

    if (!def) {
      logCanFailed(name, payload, 'Command not registered')
      return false
    }

    const result = def.can(mind, payload)

    if (!result) {
      logCanFailed(name, payload)
    }

    return result
  }
}

// ============================================================================
// 命令 API 构建器
// ============================================================================

/**
 * 构建 mind.commands API
 *
 * 中文说明：
 * - 把 runCommand 包装成结构化的 API
 * - Phase 1 先提供骨架，具体命令在 WP3 实现
 */
function buildCommandsAPI(runCommand: RunCommand): MindMapCommands {
  return {
    selection: {
      clear: (payload = {}, meta) => runCommand('selection.clear', payload, meta),
    },
    node: {
      select: (payload, meta) => runCommand('node.select', payload, meta),
      selectMany: (payload, meta) => runCommand('node.selectMany', payload, meta),
      addChild: (payload, meta) => runCommand('node.addChild', payload, meta),
      insertSiblingBefore: (payload, meta) => runCommand('node.insertSiblingBefore', payload, meta),
      insertSiblingAfter: (payload, meta) => runCommand('node.insertSiblingAfter', payload, meta),
      insertParent: (payload, meta) => runCommand('node.insertParent', payload, meta),
      removeSelected: (payload = {}, meta) => runCommand('node.removeSelected', payload, meta),
      removeByIds: (payload, meta) => runCommand('node.removeByIds', payload, meta),
      toggleExpand: (payload, meta) => runCommand('node.toggleExpand', payload, meta),
      move: (payload, meta) => runCommand('node.move', payload, meta),
      setKind: (payload, meta) => runCommand('node.setKind', payload, meta),
      setStatus: (payload, meta) => runCommand('node.setStatus', payload, meta),
      setConfidence: (payload, meta) => runCommand('node.setConfidence', payload, meta),
    },
    reflow: {
      request: (payload, meta) => runCommand('reflow.request', payload, meta),
      flushNow: (payload, meta) => runCommand('reflow.flushNow', payload, meta),
    },
  }
}

/**
 * 构建 mind.can API
 *
 * 中文说明：
 * - 与 commands 结构对齐
 * - 返回 boolean
 */
function buildCanAPI(canCheck: (name: CommandName, payload: unknown) => boolean): MindMapCan {
  return {
    selection: {
      clear: (payload = {}) => canCheck('selection.clear', payload),
    },
    node: {
      select: (payload) => canCheck('node.select', payload),
      selectMany: (payload) => canCheck('node.selectMany', payload),
      addChild: (payload) => canCheck('node.addChild', payload),
      insertSiblingBefore: (payload) => canCheck('node.insertSiblingBefore', payload),
      insertSiblingAfter: (payload) => canCheck('node.insertSiblingAfter', payload),
      insertParent: (payload) => canCheck('node.insertParent', payload),
      removeSelected: (payload = {}) => canCheck('node.removeSelected', payload),
      removeByIds: (payload) => canCheck('node.removeByIds', payload),
      toggleExpand: (payload) => canCheck('node.toggleExpand', payload),
      move: (payload) => canCheck('node.move', payload),
      setKind: (payload) => canCheck('node.setKind', payload),
      setStatus: (payload) => canCheck('node.setStatus', payload),
      setConfidence: (payload) => canCheck('node.setConfidence', payload),
    },
    reflow: {
      request: (payload) => canCheck('reflow.request', payload),
      flushNow: (payload) => canCheck('reflow.flushNow', payload),
    },
  }
}

// ============================================================================
// 安装入口
// ============================================================================

/**
 * 安装命令体系到 MindMap 实例
 *
 * 中文说明：
 * - 必须在 MindMapEngine.mount() 末尾调用
 * - 此时 mind.bus、mind.requestReflow 等基础设施已就绪
 *
 * @param mind MindMap 实例
 * @param options 配置选项
 */
export function installMindMapCommands(
  mind: MindMapInstance,
  options: { debug?: boolean } = {}
): void {
  // 注册所有命令（幂等，重复调用会覆盖）
  registerAllCommands()

  // 配置日志
  if (options.debug !== undefined) {
    setCommandLoggerConfig({ enabled: options.debug })
  }

  // 创建上下文管理器
  const ctxManager = new CommandContextManager()
  ;(mind as unknown as Record<symbol, unknown>)[COMMAND_CONTEXT_MANAGER_KEY] = ctxManager

  // ========================================================================
  // Wrap bus.fire 以自动注入 operation meta
  // ========================================================================
  wrapBusFireForOperationMeta(mind, ctxManager)

  // ========================================================================
  // Phase 3: Wrap requestReflow/requestReflowNow 以关联 txId
  // ========================================================================
  wrapReflowForTxTracking(mind, ctxManager)

  // 创建 runner 和 can checker
  const runCommand = createCommandRunner(mind)
  const canCheck = createCanChecker(mind)

  // 挂载 API
  mind.commands = buildCommandsAPI(runCommand)
  mind.can = buildCanAPI(canCheck)
  mind.runCommand = runCommand

  // 注册 dispose
  mind.disposable.push(() => {
    ctxManager.clear()
  })

  // 开发环境提示
  if (import.meta.env.MODE !== 'production') {
    console.log('[MindMapCommand] Commands installed', {
      registeredCommands: Array.from(commandRegistry.keys()),
      debug: options.debug ?? false,
    })
  }
}

/**
 * Phase 3: Wrap requestReflow/requestReflowNow 以关联 txId
 *
 * 中文说明：
 * - 当 requestReflow/requestReflowNow 被调用时，如果存在活动的命令上下文，
 *   自动把 txId 写入 scheduler 的 pendingTxIds
 * - 这样 geometryFlushed 事件就能关联到触发它的 tx
 * - scheduler 本身保持纯净，桥接逻辑在命令层
 */
function wrapReflowForTxTracking(
  mind: MindMapInstance,
  ctxManager: CommandContextManager
): void {
  const originalRequestReflow = mind.requestReflow.bind(mind)
  const originalRequestReflowNow = mind.requestReflowNow.bind(mind)
  const scheduler = mind.reflowScheduler
  if (!scheduler) {
    return
  }

  // Wrap requestReflow
  mind.requestReflow = function wrappedRequestReflow(reason) {
    // 如果有活动的命令上下文，把 txIds 写入 scheduler
    if (ctxManager.hasActive) {
      const txIds = ctxManager.getActiveTxIds()
      for (const txId of txIds) {
        scheduler.addPendingTxId(txId)
      }
    }
    return originalRequestReflow(reason)
  }

  // Wrap requestReflowNow
  mind.requestReflowNow = function wrappedRequestReflowNow(reason) {
    // 如果有活动的命令上下文，把 txIds 写入 scheduler
    if (ctxManager.hasActive) {
      const txIds = ctxManager.getActiveTxIds()
      for (const txId of txIds) {
        scheduler.addPendingTxId(txId)
      }
    }
    return originalRequestReflowNow(reason)
  }
}

/**
 * Wrap bus.fire 以自动注入 operation meta
 *
 * 中文说明：
 * - 当 fire('operation', payload) 时，如果存在活动的命令上下文，自动注入 meta
 * - 这样 operation 层无需修改任何代码，命令追踪自动生效
 * - 符合"最小侵入"原则
 */
function wrapBusFireForOperationMeta(
  mind: MindMapInstance,
  ctxManager: CommandContextManager
): void {
  const originalFire = mind.bus.fire.bind(mind.bus)

  // 重写 fire 方法
  // 中文说明：使用 unknown[] 接收所有参数，避免复杂的泛型推断
  mind.bus.fire = function wrappedFire(type: string, ...payload: unknown[]) {
    // 只处理 operation 事件
    if (type === 'operation' && payload.length > 0) {
      const ctx = ctxManager.current
      if (ctx) {
        // 获取原始 operation payload
        const op = payload[0] as import('../../shared/utils/events/eventBus').Operation

        // 注入 meta（如果 operation 层已经设置了部分 meta，则合并）
        const meta: import('../../shared/utils/events/eventBus').OperationMeta = {
          txId: ctx.txId,
          commandName: ctx.commandName,
          source: ctx.meta.source,
          structureRevision: ctx.structureRevision,
          traceId: ctx.meta.traceId,
          timestamp: Date.now(),
          // 合并 operation 层可能设置的 meta
          ...op.meta,
        }

        // 创建带 meta 的 operation
        const opWithMeta = { ...op, meta }

        // 调用原始 fire，替换第一个参数
        return (originalFire as Function).call(mind.bus, type, opWithMeta)
      }
    }

    // 非 operation 事件或无活动上下文，直接调用原始 fire
    return (originalFire as Function).apply(mind.bus, [type, ...payload])
  } as typeof mind.bus.fire
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取 mind 实例的上下文管理器
 *
 * 中文说明：
 * - 用于内部模块访问（如 reflow wrapper）
 */
export function getContextManager(mind: MindMapInstance): CommandContextManager {
  const manager = (mind as unknown as Record<symbol, unknown>)[COMMAND_CONTEXT_MANAGER_KEY]
  if (!manager) {
    throw new Error('[MindMapCommand] CommandContextManager not installed. Call installMindMapCommands first.')
  }
  return manager as CommandContextManager
}

/**
 * 获取当前活动的命令上下文
 *
 * 中文说明：
 * - 用于 operation/reflow 的 meta 注入
 * - 如果没有活动命令，返回 null
 */
export function getActiveCommandContext(mind: MindMapInstance) {
  try {
    const manager = getContextManager(mind)
    return manager.current
  } catch {
    return null
  }
}
