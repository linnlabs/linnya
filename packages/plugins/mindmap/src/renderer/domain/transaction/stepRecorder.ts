/**
 * MindMap 事务体系 — Step 记录辅助函数
 *
 * 中文说明：
 * - 提供便捷的命令层语义 step 记录 API
 * - 自动从当前命令上下文获取 txId 和 meta
 * - 供命令实现调用
 *
 * @module domain/transaction/stepRecorder
 */

import type { MindMapInstance } from '../types'
import type { CommandContext } from '../commands/types'
import type {
  TxCommandStepMeta,
  TxNodeRemoveStep,
  TxNodeAddStep,
  TxNodeToggleExpandStep,
  TxNodeMoveStep,
  TxSelectionClearStep,
  TxNodeSelectStep,
  TxRecorderInstance,
} from './types'

// ============================================================================
// TxRecorder 访问
// ============================================================================

/** 内部字段名（挂载到 mind.debug） */
const TX_RECORDER_KEY = 'txRecorder'

/**
 * 获取 TxRecorder 实例（如果已安装）
 *
 * 中文说明：
 * - 如果 TxRecorder 未安装，返回 null
 * - 命令层不应因 TxRecorder 未安装而失败
 */
function getTxRecorder(mind: MindMapInstance): TxRecorderInstance | null {
  const debug = (mind as unknown as { debug?: Record<string, unknown> }).debug
  if (!debug || !debug[TX_RECORDER_KEY]) {
    return null
  }
  return debug[TX_RECORDER_KEY] as TxRecorderInstance
}

// ============================================================================
// Step Meta 构建
// ============================================================================

/**
 * 从 CommandContext 构建 TxCommandStepMeta
 */
function buildStepMeta(ctx: CommandContext): TxCommandStepMeta {
  return {
    at: Date.now(),
    source: 'command',
    commandName: ctx.commandName,
    commandSource: ctx.meta.source,
    traceId: ctx.meta.traceId,
  }
}

// ============================================================================
// Step 记录便捷函数
// ============================================================================

/**
 * 记录 node.remove 语义 step
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param nodeIds 被删除的节点 ID 列表（归一化后）
 * @param before 可选：删除前的位置快照
 */
export function recordNodeRemoveStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  nodeIds: string[],
  before?: TxNodeRemoveStep['before']
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxNodeRemoveStep = {
    kind: 'command',
    type: 'node.remove',
    payload: { nodeIds },
    before,
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}

/**
 * 记录 node.add 语义 step（addChild/insertSibling/insertParent）
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param subType 操作子类型
 * @param refNodeId 参考节点 ID
 * @param edit 是否进入编辑模式
 * @param newNodeId 新节点 ID（如果已知）
 */
export function recordNodeAddStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  subType: TxNodeAddStep['payload']['subType'],
  refNodeId: string,
  edit: boolean,
  newNodeId?: string
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxNodeAddStep = {
    kind: 'command',
    type: 'node.add',
    payload: {
      subType,
      refNodeId,
      edit,
      newNodeId,
    },
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}

/**
 * 记录 node.toggleExpand 语义 step
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param nodeId 节点 ID
 * @param wasExpanded 操作前的展开状态
 * @param isExpanded 操作后的展开状态
 */
export function recordNodeToggleExpandStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  nodeId: string,
  wasExpanded: boolean,
  isExpanded: boolean
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxNodeToggleExpandStep = {
    kind: 'command',
    type: 'node.toggleExpand',
    payload: {
      nodeId,
      wasExpanded,
      isExpanded,
    },
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}

/**
 * 记录 node.move 语义 step
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param fromNodeIds 被移动的节点 ID 列表
 * @param toNodeId 目标节点 ID
 * @param position 位置
 * @param before 可选：移动前的位置快照
 */
export function recordNodeMoveStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  fromNodeIds: string[],
  toNodeId: string,
  position: 'before' | 'after' | 'in',
  before?: TxNodeMoveStep['before']
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxNodeMoveStep = {
    kind: 'command',
    type: 'node.move',
    payload: {
      fromNodeIds,
      toNodeId,
      position,
    },
    before,
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}

/**
 * 记录 selection.clear 语义 step
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param previousNodeIds 清空前的选中节点 ID 列表
 */
export function recordSelectionClearStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  previousNodeIds: string[]
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxSelectionClearStep = {
    kind: 'command',
    type: 'selection.clear',
    payload: { previousNodeIds },
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}

/**
 * 记录 node.select 语义 step
 *
 * @param ctx 命令上下文
 * @param mind MindMap 实例
 * @param nodeIds 选中的节点 ID 列表
 * @param replace 是否替换现有选区
 * @param previousNodeIds 操作前的选中节点 ID 列表
 */
export function recordNodeSelectStep(
  ctx: CommandContext,
  mind: MindMapInstance,
  nodeIds: string[],
  replace: boolean,
  previousNodeIds: string[]
): void {
  const recorder = getTxRecorder(mind)
  if (!recorder) return

  const step: TxNodeSelectStep = {
    kind: 'command',
    type: 'node.select',
    payload: {
      nodeIds,
      replace,
      previousNodeIds,
    },
    meta: buildStepMeta(ctx),
  }

  recorder.recordCommandStep(ctx.txId, step)
}
