/**
 * MindMap 命令体系 — 选择相关命令
 *
 * 中文说明：
 * - selection.clear / node.select / node.selectMany
 * - 内部调用现有实例方法，不推翻 interaction 层
 *
 * @module domain/commands/commands/selectionCommands
 */

import type { MindMapInstance } from '../../types'
import type { CommandDef, CommandContext, CommandResult } from '../types'
import { requireDocumentReady, requireValidNodeId, requireValidNodeIds, requireNodeExists, requireAllNodesExist, allLazy } from '../guards'

// ============================================================================
// Payload 类型
// ============================================================================

export interface SelectPayload {
  nodeId: string
}

export interface SelectManyPayload {
  nodeIds: string[]
  /** 是否清空已有选中（默认 true） */
  replace?: boolean
}

// ============================================================================
// selection.clear — 清空选区
// ============================================================================

export const selectionClearCommand: CommandDef<Record<string, never>> = {
  name: 'selection.clear',

  can(mind: MindMapInstance, _payload: Record<string, never>): boolean {
    // 清空选区始终可执行（即使选区已空）
    const guard = requireDocumentReady(mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, _payload: Record<string, never>): CommandResult {
    const guard = requireDocumentReady(mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 调用现有方法
    mind.clearSelection()

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.select — 选中单个节点
// ============================================================================

export const nodeSelectCommand: CommandDef<SelectPayload> = {
  name: 'node.select',

  can(mind: MindMapInstance, payload: SelectPayload): boolean {
    const guard = allLazy(
      () => requireDocumentReady(mind),
      () => requireValidNodeId(payload?.nodeId),
      () => requireNodeExists(payload?.nodeId, mind)
    )
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: SelectPayload): CommandResult {
    const guard = allLazy(
      () => requireDocumentReady(mind),
      () => requireValidNodeId(payload?.nodeId),
      () => requireNodeExists(payload?.nodeId, mind)
    )
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 查找 DOM 元素
    let topic
    try {
      topic = mind.findEle(payload.nodeId)
    } catch {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node DOM not found: ${payload.nodeId}` }
    }

    // 调用现有方法
    mind.selectNode(topic)

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// node.selectMany — 选中多个节点
// ============================================================================

export const nodeSelectManyCommand: CommandDef<SelectManyPayload> = {
  name: 'node.selectMany',

  can(mind: MindMapInstance, payload: SelectManyPayload): boolean {
    const guard = allLazy(
      () => requireDocumentReady(mind),
      () => requireValidNodeIds(payload?.nodeIds),
      () => requireAllNodesExist(payload?.nodeIds ?? [], mind)
    )
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: SelectManyPayload): CommandResult {
    const guard = allLazy(
      () => requireDocumentReady(mind),
      () => requireValidNodeIds(payload?.nodeIds),
      () => requireAllNodesExist(payload?.nodeIds ?? [], mind)
    )
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    const replace = payload.replace ?? true

    // 如果需要替换，先清空
    if (replace) {
      mind.clearSelection()
    }

    // 查找所有 DOM 元素
    const topics = []
    for (const nodeId of payload.nodeIds) {
      try {
        const topic = mind.findEle(nodeId)
        topics.push(topic)
      } catch {
        // 节点可能折叠，跳过
        continue
      }
    }

    if (topics.length === 0) {
      // 所有节点都折叠了，不算失败
      return { ok: true, txId: ctx.txId }
    }

    // 调用现有方法
    mind.selectNodes(topics)

    return { ok: true, txId: ctx.txId }
  },
}

// ============================================================================
// 导出所有命令
// ============================================================================

export const selectionCommands = [
  selectionClearCommand,
  nodeSelectCommand,
  nodeSelectManyCommand,
] as const
