/**
 * MindMap 命令体系 — 打标命令（Tagging Commands）
 *
 * 中文说明：
 * - node.setKind：设置节点语义类型（假设/子问题/结论）
 * - 遵循 commands 契约：
 *   - payload 只传业务字段，禁止 DOM 泄漏
 *   - can 纯检查，run 执行副作用
 *   - 通过 operation 事件触发 dirty
 *
 * @module domain/commands/commands/taggingCommands
 */

import type { MindMapInstance, NodeObj, NodeTagging } from '../../types'
import type { CommandDef, CommandContext, CommandResult } from '../types'
import { guardsForSingleNodeAllowRoot } from '../guards'
import { findNodeObjById } from '../normalize'
import { deepClone } from '../../../shared/utils'
import {
  type NodeKind,
  canSetStatusForKind,
  canSetConfidenceForKind,
  isValidStatusValue,
  isValidConfidenceValue,
  normalizeTaggingForKind,
  parseNodeKind,
  isSameTagging,
} from '../../tagging/taggingRules'

// ============================================================================
// Node Kind 常量与类型
// ============================================================================

/**
 * 节点语义类型的中文映射（用于 UI 展示）
 */
export const NODE_KIND_LABELS: Record<string, string> = {
  hypothesis: '假设',
  question: '子问题',
  conclusion: '结论',
}

// ============================================================================
// Payload 类型
// ============================================================================

/**
 * node.setKind 命令的 payload
 *
 * 中文说明：
 * - nodeId：目标节点 ID
 * - kind：节点语义类型，传 null/undefined 表示清除
 */
export interface SetKindPayload {
  nodeId: string
  /**
   * 节点语义类型
   * - 'hypothesis' | 'question' | 'conclusion'：设置类型
   * - null | undefined：清除类型
   */
  kind?: string | null
}

/**
 * node.setStatus 命令的 payload
 */
export interface SetStatusPayload {
  nodeId: string
  /**
   * 节点状态
   * - null/undefined：清除状态
   */
  status?: string | null
}

/**
 * node.setConfidence 命令的 payload
 */
export interface SetConfidencePayload {
  nodeId: string
  /**
   * 置信度（high/medium/low 或数值）
   * - null/undefined：清除置信度
   */
  confidence?: string | number | null
}

// ============================================================================
// 内部工具函数
// ============================================================================

function getNodeKind(nodeObj: NodeObj): NodeKind | undefined {
  return parseNodeKind(nodeObj.tagging?.labels?.kind)
}

function buildTaggingDraft(nodeObj: NodeObj): NodeTagging {
  const draft: NodeTagging = {}
  if (typeof nodeObj.tagging?.status === 'string') {
    draft.status = nodeObj.tagging.status
  }
  if (typeof nodeObj.tagging?.confidence === 'string' || typeof nodeObj.tagging?.confidence === 'number') {
    draft.confidence = nodeObj.tagging.confidence
  }
  if (nodeObj.tagging?.labels) {
    draft.labels = { ...nodeObj.tagging.labels }
  }
  return draft
}

function commitTaggingChange(
  ctx: CommandContext,
  mind: MindMapInstance,
  nodeObj: NodeObj,
  nextTagging: NodeTagging | undefined
): CommandResult {
  if (isSameTagging(nodeObj.tagging, nextTagging)) {
    return { ok: true, txId: ctx.txId }
  }

  // 触发变更：优先走既有 operations（reshapeNode），保证 operation 语义与 reflow 口径一致
  try {
    const topic = mind.findEle(nodeObj.id)
    mind.reshapeNode(topic, { tagging: nextTagging })
  } catch {
    // 节点可能折叠（DOM 不可命中）。降级：只改数据并发出 reshapeNode operation（不做 DOM 重渲染）。
    const origin = deepClone(nodeObj)
    nodeObj.tagging = nextTagging
    mind.bus.fire('operation', { name: 'reshapeNode', obj: nodeObj, origin })
  }

  return { ok: true, txId: ctx.txId }
}

// ============================================================================
// node.setKind — 设置节点语义类型
// ============================================================================

export const nodeSetKindCommand: CommandDef<SetKindPayload> = {
  name: 'node.setKind',

  can(mind: MindMapInstance, payload: SetKindPayload): boolean {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: SetKindPayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    // 找到节点对象
    const nodeObj = findNodeObjById(payload.nodeId, mind.nodeData)
    if (!nodeObj) {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node not found: ${payload.nodeId}` }
    }

    const nextKind =
      payload.kind === null || payload.kind === undefined ? undefined : parseNodeKind(payload.kind)
    if (payload.kind !== null && payload.kind !== undefined && !nextKind) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'invalidPayload',
        message: `Unsupported node kind: ${payload.kind}`,
      }
    }

    const draft = buildTaggingDraft(nodeObj)
    if (nextKind) {
      draft.labels = { ...(draft.labels ?? {}), kind: nextKind }
    } else if (draft.labels) {
      delete draft.labels.kind
    }

    const normalized = normalizeTaggingForKind(nextKind, draft)
    return commitTaggingChange(ctx, mind, nodeObj, normalized)
  },
}

// ============================================================================
// node.setStatus — 设置节点状态
// ============================================================================

export const nodeSetStatusCommand: CommandDef<SetStatusPayload> = {
  name: 'node.setStatus',

  can(mind: MindMapInstance, payload: SetStatusPayload): boolean {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: SetStatusPayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    const nodeObj = findNodeObjById(payload.nodeId, mind.nodeData)
    if (!nodeObj) {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node not found: ${payload.nodeId}` }
    }

    const kind = getNodeKind(nodeObj)
    if (!canSetStatusForKind(kind)) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'invalidPayload',
        message: '当前节点类型不允许设置状态',
      }
    }

    if (payload.status !== null && payload.status !== undefined && !isValidStatusValue(payload.status)) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'invalidPayload',
        message: `不支持的状态值：${payload.status}`,
      }
    }

    const draft = buildTaggingDraft(nodeObj)
    if (payload.status === null || payload.status === undefined) {
      delete draft.status
    } else {
      draft.status = payload.status
    }

    const normalized = normalizeTaggingForKind(kind, draft)
    return commitTaggingChange(ctx, mind, nodeObj, normalized)
  },
}

// ============================================================================
// node.setConfidence — 设置置信度
// ============================================================================

export const nodeSetConfidenceCommand: CommandDef<SetConfidencePayload> = {
  name: 'node.setConfidence',

  can(mind: MindMapInstance, payload: SetConfidencePayload): boolean {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    return guard.ok
  },

  run(ctx: CommandContext, mind: MindMapInstance, payload: SetConfidencePayload): CommandResult {
    const guard = guardsForSingleNodeAllowRoot(payload?.nodeId, mind)
    if (!guard.ok) {
      return { ok: false, txId: ctx.txId, reason: guard.reason, message: guard.message }
    }

    const nodeObj = findNodeObjById(payload.nodeId, mind.nodeData)
    if (!nodeObj) {
      return { ok: false, txId: ctx.txId, reason: 'notFound', message: `Node not found: ${payload.nodeId}` }
    }

    const kind = getNodeKind(nodeObj)
    if (!canSetConfidenceForKind(kind)) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'invalidPayload',
        message: '当前节点类型不允许设置置信度',
      }
    }

    if (
      payload.confidence !== null &&
      payload.confidence !== undefined &&
      !isValidConfidenceValue(payload.confidence)
    ) {
      return {
        ok: false,
        txId: ctx.txId,
        reason: 'invalidPayload',
        message: `不支持的置信度值：${payload.confidence}`,
      }
    }

    const draft = buildTaggingDraft(nodeObj)
    if (payload.confidence === null || payload.confidence === undefined) {
      delete draft.confidence
    } else {
      draft.confidence = payload.confidence
    }

    const normalized = normalizeTaggingForKind(kind, draft)
    return commitTaggingChange(ctx, mind, nodeObj, normalized)
  },
}

// ============================================================================
// 导出所有命令
// ============================================================================

export const taggingCommands = [
  nodeSetKindCommand,
  nodeSetStatusCommand,
  nodeSetConfidenceCommand,
] as const
