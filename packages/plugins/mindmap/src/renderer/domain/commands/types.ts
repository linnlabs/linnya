/**
 * MindMap 命令体系 — 核心类型定义
 *
 * 中文说明：
 * - 本文件定义命令层的所有核心类型
 * - 遵循 contracts.md：payload 只允许业务字段（nodeId/documentId/...），禁止 DOM/Topic/MouseEvent
 * - 对齐 COMMANDS_API_DRAFT.md 的接口草案
 *
 * @module domain/commands/types
 */

import type { MindMapInstance } from '../types'

// ============================================================================
// CommandSource — 命令来源（用于可观测与治理）
// ============================================================================

/**
 * 命令来源类型
 *
 * 中文说明：
 * - 每个命令执行时必须指定来源，用于日志追踪与诊断
 * - Phase 2 的 IntentRouter 会依赖此字段做路由决策
 */
export type CommandSource =
  | 'hotkey' // 快捷键触发
  | 'contextMenu' // 右键菜单触发
  | 'toolbar' // 工具栏触发
  | 'mouse' // 鼠标交互触发（如点击展开按钮）
  | 'feature' // feature 内部触发
  | 'script' // 脚本/API 调用触发
  | 'unknown' // 未知来源（应尽量避免）

// ============================================================================
// CommandMeta — 命令元信息
// ============================================================================

/**
 * 命令元信息（外部入口传入部分）
 *
 * 中文说明：
 * - source 必填：用于可观测
 * - traceId 可选：用于跨系统串联（IPC、后端日志等）
 * - internal/addToHistory/userNotification：Phase 1 预留，暂不实现
 */
export interface CommandMeta {
  source: CommandSource
  traceId?: string
  timestamp?: number
  /**
   * 内部操作标记（不影响 dirty/提示等）
   * Phase 1 预留，暂不实现
   */
  internal?: boolean
  /**
   * 是否进入 undo/redo
   * Phase 1 预留，暂不实现
   */
  addToHistory?: boolean
  /**
   * 用户提示配置
   * Phase 1 预留，暂不实现
   */
  userNotification?: {
    message: string
    type?: 'info' | 'success' | 'warning' | 'error'
    durationMs?: number
  }
}

// ============================================================================
// CommandContext — 运行期上下文
// ============================================================================

/**
 * 命令执行上下文（由 runner 生成）
 *
 * 中文说明：
 * - 贯穿命令执行全过程
 * - 用于关联 operation/reflow 的可观测链路
 */
export interface CommandContext {
  /** 命令名称 */
  commandName: string
  /** 事务 ID（唯一标识一次命令执行） */
  txId: string
  /** 文档 ID */
  documentId: string | null
  /** 结构修订号（执行开始时快照） */
  structureRevision: number
  /** 执行开始时间戳 */
  startedAt: number
  /** 元信息 */
  meta: CommandMeta
}

// ============================================================================
// CommandResult — 命令执行结果
// ============================================================================

/**
 * 命令失败原因（必须可枚举，用于 UI 决策与日志聚合）
 */
export type CommandFailReason =
  | 'missingDocumentId' // 文档上下文未就绪
  | 'invalidPayload' // payload 校验失败
  | 'forbidden' // 被 guard 拦截（如 root 节点禁止删除）
  | 'notFound' // 目标节点不存在
  | 'noSelection' // 需要选区但当前无选中
  | 'internalError' // 内部错误

/**
 * 命令执行结果
 *
 * 中文说明：
 * - 成功：ok=true，返回 txId
 * - 失败：ok=false，返回 txId + reason（禁止 silent fallback）
 */
export type CommandResult =
  | { ok: true; txId: string }
  | { ok: false; txId: string; reason: CommandFailReason; message?: string }

// ============================================================================
// CommandName — 命令名称（Phase 1 最小集）
// ============================================================================

/**
 * 命令名称联合类型
 *
 * 中文说明：
 * - Phase 1 先覆盖基础能力
 * - 后续 Phase 可逐步扩展
 */
export type CommandName =
  // 选择相关
  | 'selection.clear'
  | 'node.select'
  | 'node.selectMany'
  // 节点操作
  | 'node.addChild'
  | 'node.insertSiblingBefore'
  | 'node.insertSiblingAfter'
  | 'node.insertParent'
  | 'node.removeSelected'
  | 'node.removeByIds'
  | 'node.toggleExpand'
  // 打标操作
  | 'node.setKind'
  | 'node.setStatus'
  | 'node.setConfidence'
  // 重算
  | 'reflow.request'
  | 'reflow.flushNow'
  // Phase 3 预留
  | 'node.move'
  | 'node.reparent'

// ============================================================================
// CommandDef — 命令定义
// ============================================================================

/**
 * 命令定义接口
 *
 * 中文说明：
 * - can：纯检查，无副作用（禁止 DOM 操作/store 写入/IPC）
 * - run：执行命令，有副作用
 */
export interface CommandDef<P = unknown> {
  name: CommandName
  /**
   * 检查命令是否可执行（纯检查，无副作用）
   *
   * 中文说明：
   * - 禁止 DOM 命中（findEle/querySelector/getBoundingClientRect 等）
   * - 禁止 store 写入
   * - 禁止 IPC 调用
   */
  can: (mind: MindMapInstance, payload: P) => boolean
  /**
   * 执行命令（有副作用）
   */
  run: (ctx: CommandContext, mind: MindMapInstance, payload: P) => CommandResult
}

// ============================================================================
// OperationMeta — operation 事件的元信息扩展
// ============================================================================

/**
 * Operation 事件的命令元信息
 *
 * 中文说明：
 * - Phase 1 只做关联，不改 ownership
 * - operation 仍由 domain/operations 触发
 * - 命令层通过 meta 注入实现关联
 */
export interface OperationMeta {
  txId: string
  commandName: string
  source: CommandSource
  traceId?: string
  structureRevision: number
}

// ============================================================================
// MindMapCommands / MindMapCan — 对外 API 形状
// ============================================================================

/**
 * 命令 API 形状（挂载到 mind.commands）
 *
 * 中文说明：
 * - Phase 1 先定义骨架
 * - 具体命令在 WP3 实现后填充
 */
export interface MindMapCommands {
  selection: {
    clear: (payload?: Record<string, never>, meta?: Partial<CommandMeta>) => CommandResult
  }
  node: {
    select: (payload: { nodeId: string }, meta?: Partial<CommandMeta>) => CommandResult
    selectMany: (
      payload: { nodeIds: string[]; replace?: boolean },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    addChild: (payload: { nodeId: string; edit?: boolean }, meta?: Partial<CommandMeta>) => CommandResult
    insertSiblingBefore: (
      payload: { nodeId: string; edit?: boolean },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    insertSiblingAfter: (
      payload: { nodeId: string; edit?: boolean },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    insertParent: (payload: { nodeId: string; edit?: boolean }, meta?: Partial<CommandMeta>) => CommandResult
    removeSelected: (payload?: Record<string, never>, meta?: Partial<CommandMeta>) => CommandResult
    removeByIds: (payload: { nodeIds: string[] }, meta?: Partial<CommandMeta>) => CommandResult
    toggleExpand: (payload: { nodeId: string }, meta?: Partial<CommandMeta>) => CommandResult
    /** Phase 3 WP3-4：节点移动（拖拽命令化） */
    move: (
      payload: {
        fromNodeIds: string[]
        toNodeId: string
        position: 'before' | 'after' | 'in'
      },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    /**
     * 设置节点语义类型（假设/子问题/结论）
     *
     * 中文说明：
     * - kind: 'hypothesis' | 'question' | 'conclusion' 或自定义值
     * - kind 为 null/undefined 时清除类型
     */
    setKind: (
      payload: { nodeId: string; kind?: string | null },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    /**
     * 设置节点状态（已证实/已证伪/待验证/已关闭）
     */
    setStatus: (
      payload: { nodeId: string; status?: string | null },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    /**
     * 设置节点置信度（高/中/低 或数值）
     */
    setConfidence: (
      payload: { nodeId: string; confidence?: string | number | null },
      meta?: Partial<CommandMeta>
    ) => CommandResult
  }
  reflow: {
    request: (
      payload: { reason: string },
      meta?: Partial<CommandMeta>
    ) => CommandResult
    flushNow: (
      payload: { reason: 'core:init' | 'core:refresh' },
      meta?: Partial<CommandMeta>
    ) => CommandResult
  }
}

/**
 * can API 形状（挂载到 mind.can）
 *
 * 中文说明：
 * - 与 commands 结构对齐
 * - 返回 boolean，不产生副作用
 */
export interface MindMapCan {
  selection: {
    clear: (payload?: Record<string, never>) => boolean
  }
  node: {
    select: (payload: { nodeId: string }) => boolean
    selectMany: (payload: { nodeIds: string[]; replace?: boolean }) => boolean
    addChild: (payload: { nodeId: string; edit?: boolean }) => boolean
    insertSiblingBefore: (payload: { nodeId: string; edit?: boolean }) => boolean
    insertSiblingAfter: (payload: { nodeId: string; edit?: boolean }) => boolean
    insertParent: (payload: { nodeId: string; edit?: boolean }) => boolean
    removeSelected: (payload?: Record<string, never>) => boolean
    removeByIds: (payload: { nodeIds: string[] }) => boolean
    toggleExpand: (payload: { nodeId: string }) => boolean
    /** Phase 3 WP3-4：节点移动（拖拽命令化） */
    move: (payload: {
      fromNodeIds: string[]
      toNodeId: string
      position: 'before' | 'after' | 'in'
    }) => boolean
    /**
     * 检查是否可以设置节点语义类型
     */
    setKind: (payload: { nodeId: string; kind?: string | null }) => boolean
    /**
     * 检查是否可以设置节点状态
     */
    setStatus: (payload: { nodeId: string; status?: string | null }) => boolean
    /**
     * 检查是否可以设置节点置信度
     */
    setConfidence: (payload: { nodeId: string; confidence?: string | number | null }) => boolean
  }
  reflow: {
    request: (payload: { reason: string }) => boolean
    flushNow: (payload: { reason: 'core:init' | 'core:refresh' }) => boolean
  }
}

// ============================================================================
// RunCommand — 统一 runner 入口类型
// ============================================================================

/**
 * 统一命令执行函数类型
 */
export type RunCommand = <P = unknown>(
  name: CommandName,
  payload: P,
  meta?: Partial<CommandMeta>
) => CommandResult
