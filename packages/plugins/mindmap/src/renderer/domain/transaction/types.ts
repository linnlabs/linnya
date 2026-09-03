/**
 * MindMap 事务体系 — 核心类型定义
 *
 * 中文说明：
 * - 本文件定义 Transaction 体系的所有核心类型
 * - 遵循 contracts.md：payload 只允许业务字段（nodeId/...），禁止 DOM/Topic/MouseEvent
 * - 对齐 Phase 3 的设计：tx 边界 + steps + meta + mapping
 *
 * 关键约束（Phase 3 必须满足）：
 * - tx 必须是可序列化的记录（至少 steps + meta + mapping 可序列化）
 * - tx 内 steps 必须满足：payload 无 DOM/Topic/Event，只使用 nodeId
 * - tx 与现有系统必须能关联：command runner 产生 txId（已存在）
 *
 * @module domain/transaction/types
 */

import type { CommandSource } from '../commands/types'
import type { ReflowReason } from '../../shared/utils/reflow/ReflowScheduler'
import type { OperationType, OperationMeta } from '../../shared/utils/events/eventBus'

// ============================================================================
// TxMeta — 事务元信息
// ============================================================================

/**
 * 事务元信息（从 CommandMeta/CommandContext 派生）
 *
 * 中文说明：
 * - 记录事务的来源与追踪信息
 * - 可序列化，用于诊断/回放
 */
export interface TxMeta {
  /** 触发此事务的命令名称 */
  commandName: string
  /** 命令来源 */
  source: CommandSource
  /** 外部追踪 ID（来自 intent，便于跨 tx 聚合） */
  traceId?: string
  /** 文档 ID */
  documentId: string | null
  /** 结构版本号（事务开始时快照） */
  structureRevision: number
  /** 事务开始时间戳 */
  startedAt: number
  /** 事务结束时间戳（flush 后填充） */
  endedAt?: number
  /** 耗时（毫秒） */
  durationMs?: number
}

// ============================================================================
// TxStepRecord — 语义步骤记录
// ============================================================================

/**
 * Step 来源标识
 *
 * 中文说明：
 * - 用于区分 step 是来自 command 内部、operation fire、还是 reflow
 */
export type TxStepSource = 'operation' | 'reflow' | 'custom'

/**
 * Step 统一 meta（每个 step 都带）
 *
 * 中文说明：
 * - 对齐 Phase 3 设计：at（时间戳）、source、traceId
 * - 便于跨 tx 聚合与回放
 */
export interface TxStepMeta {
  /** 时间戳（或 command 内相对序号） */
  at: number
  /** 来源 */
  source: TxStepSource
}

/**
 * Operation 类型的 step 记录
 *
 * 中文说明：
 * - 来自 bus.fire('operation', payload)
 * - operationType 是 OperationType 联合类型
 * - payload 是 operation 的具体内容（不含 meta）
 */
export interface TxOperationStep {
  kind: 'operation'
  operationType: OperationType
  /** operation payload（已脱敏，不含 meta） */
  payload: Record<string, unknown>
  meta: TxStepMeta
}

/**
 * Reflow 类型的 step 记录
 *
 * 中文说明：
 * - 记录 geometryFlushed 事件
 * - reasons 是触发重算的原因集合
 */
export interface TxReflowStep {
  kind: 'reflow'
  reasons: ReflowReason[]
  coalescedCount: number
  durationMs: number
  meta: TxStepMeta
}

/**
 * 自定义 step 记录（预留）
 *
 * 中文说明：
 * - 用于未来扩展（如 selection 变化、视图操作等）
 */
export interface TxCustomStep {
  kind: 'custom'
  name: string
  payload: Record<string, unknown>
  meta: TxStepMeta
}

// ============================================================================
// 命令层语义 Step（Phase 3 WP3-2）
// ============================================================================

/**
 * 命令 Step 的来源（扩展 TxStepSource）
 */
export type TxCommandStepSource = 'command'

/**
 * 命令 Step 的统一 meta
 *
 * 中文说明：
 * - 继承 TxStepMeta 并扩展命令层特有字段
 * - source 固定为 'command'
 */
export interface TxCommandStepMeta extends Omit<TxStepMeta, 'source'> {
  source: TxCommandStepSource
  /** 命令名称 */
  commandName: string
  /** 命令来源（hotkey/mouse/...） */
  commandSource: CommandSource
  /** 外部追踪 ID（可选） */
  traceId?: string
}

/**
 * node.remove 语义 step
 *
 * 中文说明：
 * - 记录删除节点的语义
 * - nodeIds 是归一化后的节点 ID 列表（已去重、过滤 root、祖先链收敛）
 */
export interface TxNodeRemoveStep {
  kind: 'command'
  type: 'node.remove'
  payload: {
    /** 被删除的节点 ID 列表 */
    nodeIds: string[]
  }
  /** 可选：删除前的节点快照（用于 undo） */
  before?: {
    /** 节点与其父节点的关系（便于恢复） */
    nodeParentMap: Record<string, string>
    /** 节点在兄弟中的索引 */
    nodeIndexMap: Record<string, number>
  }
  meta: TxCommandStepMeta
}

/**
 * node.add 语义 step（addChild/insertSibling/insertParent）
 *
 * 中文说明：
 * - 记录新增节点的语义
 * - 统一为 add 类型，通过 subType 区分具体操作
 */
export interface TxNodeAddStep {
  kind: 'command'
  type: 'node.add'
  payload: {
    /** 操作子类型 */
    subType: 'addChild' | 'insertSiblingBefore' | 'insertSiblingAfter' | 'insertParent'
    /** 参考节点 ID（操作基于哪个节点） */
    refNodeId: string
    /** 新节点 ID（如果已知） */
    newNodeId?: string
    /** 是否进入编辑模式 */
    edit: boolean
  }
  meta: TxCommandStepMeta
}

/**
 * node.toggleExpand 语义 step
 *
 * 中文说明：
 * - 记录展开/折叠节点的语义
 */
export interface TxNodeToggleExpandStep {
  kind: 'command'
  type: 'node.toggleExpand'
  payload: {
    /** 节点 ID */
    nodeId: string
    /** 操作前的展开状态 */
    wasExpanded: boolean
    /** 操作后的展开状态 */
    isExpanded: boolean
  }
  meta: TxCommandStepMeta
}

/**
 * node.move 语义 step（Phase 3 预留，用于拖拽命令化）
 *
 * 中文说明：
 * - 记录移动节点的语义
 * - 统一用于同层移动和跨层重新挂载
 */
export interface TxNodeMoveStep {
  kind: 'command'
  type: 'node.move'
  payload: {
    /** 被移动的节点 ID 列表 */
    fromNodeIds: string[]
    /** 目标节点 ID */
    toNodeId: string
    /** 位置 */
    position: 'before' | 'after' | 'in'
  }
  /** 可选：移动前的位置快照（用于 undo） */
  before?: {
    /** 节点与其父节点的关系 */
    nodeParentMap: Record<string, string>
    /** 节点在兄弟中的索引 */
    nodeIndexMap: Record<string, number>
  }
  meta: TxCommandStepMeta
}

/**
 * selection.clear 语义 step
 *
 * 中文说明：
 * - 记录清空选区的语义
 */
export interface TxSelectionClearStep {
  kind: 'command'
  type: 'selection.clear'
  payload: {
    /** 清空前的选中节点 ID 列表 */
    previousNodeIds: string[]
  }
  meta: TxCommandStepMeta
}

/**
 * node.select 语义 step
 *
 * 中文说明：
 * - 记录选择节点的语义
 */
export interface TxNodeSelectStep {
  kind: 'command'
  type: 'node.select'
  payload: {
    /** 选中的节点 ID 列表 */
    nodeIds: string[]
    /** 是否替换现有选区 */
    replace: boolean
    /** 操作前的选中节点 ID 列表 */
    previousNodeIds: string[]
  }
  meta: TxCommandStepMeta
}

/**
 * 命令层语义 Step 联合类型
 */
export type TxCommandStep =
  | TxNodeRemoveStep
  | TxNodeAddStep
  | TxNodeToggleExpandStep
  | TxNodeMoveStep
  | TxSelectionClearStep
  | TxNodeSelectStep

/**
 * Step 联合类型（扩展）
 */
export type TxStep = TxOperationStep | TxReflowStep | TxCustomStep | TxCommandStep

// ============================================================================
// TxMappingRecord — 节点 ID 映射
// ============================================================================

/**
 * 节点 ID 映射记录
 *
 * 中文说明：
 * - 用于 copy/paste 等操作产生新 nodeId 时的映射
 * - 为后续 replay/协同预留
 */
export interface TxMappingRecord {
  /** 旧 nodeId -> 新 nodeId */
  nodeIdMap: Map<string, string>
  /** 映射创建时间戳 */
  createdAt: number
}

// ============================================================================
// TxRecord — 完整事务记录
// ============================================================================

/**
 * 事务状态
 */
export type TxStatus = 'running' | 'completed' | 'failed'

/**
 * 完整事务记录
 *
 * 中文说明：
 * - 以 txId 为 key，聚合 steps、operations、reflow reasons 等
 * - 可序列化，用于诊断/回放/压测
 */
export interface TxRecord {
  /** 事务 ID（唯一标识） */
  txId: string
  /** 事务状态 */
  status: TxStatus
  /** 事务元信息 */
  meta: TxMeta
  /** 语义步骤集合（按时间排序） */
  steps: TxStep[]
  /**
   * 关联的 operation meta 集合
   *
   * 中文说明：
   * - 来自 bus.fire('operation', payload) 时 payload.meta
   * - 用于关联 operation -> history
   */
  operationMetas: OperationMeta[]
  /**
   * 触发的 reflow reasons 集合
   *
   * 中文说明：
   * - 来自 geometryFlushed 事件
   * - 用于诊断"一次命令触发了哪些重算"
   */
  reflowReasons: ReflowReason[]
  /**
   * 节点 ID 映射（可选）
   *
   * 中文说明：
   * - 仅在产生新 nodeId 时填充
   */
  mapping?: TxMappingRecord
}

// ============================================================================
// TxRecorder 配置选项
// ============================================================================

/**
 * TxRecorder 配置
 */
export interface TxRecorderOptions {
  /** 是否启用调试日志（默认 false） */
  debug?: boolean
  /** 保留的最大事务数（默认 100） */
  maxRecords?: number
  /** 是否记录 operation steps（默认 true） */
  recordOperations?: boolean
  /** 是否记录 reflow steps（默认 true） */
  recordReflows?: boolean
}

// ============================================================================
// TxRecorder API 接口
// ============================================================================

/**
 * TxRecorder 实例接口
 *
 * 中文说明：
 * - 通过 installTxRecorder(mind) 安装
 * - 提供事务记录的查询与管理能力
 */
export interface TxRecorderInstance {
  /**
   * 获取事务记录
   * @param txId 事务 ID
   */
  getRecord(txId: string): TxRecord | undefined

  /**
   * 获取最近 N 条事务记录
   * @param count 数量（默认 10）
   */
  getRecentRecords(count?: number): TxRecord[]

  /**
   * 获取所有事务记录
   */
  getAllRecords(): TxRecord[]

  /**
   * 记录命令层语义 step（WP3-2）
   *
   * 中文说明：
   * - 由命令层调用，记录语义步骤
   * - step 会自动关联到当前活动的 tx
   * @param txId 事务 ID
   * @param step 命令层语义 step
   */
  recordCommandStep(txId: string, step: TxCommandStep): void

  /**
   * 清空所有记录
   */
  clear(): void

  /**
   * 输出诊断摘要（开发态）
   */
  dumpSummary(): void

  /**
   * 卸载
   */
  dispose(): void
}

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 可序列化的 TxRecord（用于导出/持久化）
 *
 * 中文说明：
 * - mapping 中的 Map 转换为普通对象
 */
export interface SerializableTxRecord extends Omit<TxRecord, 'mapping'> {
  mapping?: {
    nodeIdMap: Record<string, string>
    createdAt: number
  }
}

/**
 * 将 TxRecord 转换为可序列化格式
 */
export function toSerializable(record: TxRecord): SerializableTxRecord {
  // 提取 mapping 之外的字段
  const { mapping, ...rest } = record

  const serializable: SerializableTxRecord = {
    ...rest,
  }

  if (mapping) {
    serializable.mapping = {
      nodeIdMap: Object.fromEntries(mapping.nodeIdMap),
      createdAt: mapping.createdAt,
    }
  }

  return serializable
}

/**
 * 从可序列化格式恢复 TxRecord
 */
export function fromSerializable(serializable: SerializableTxRecord): TxRecord {
  const record: TxRecord = {
    ...serializable,
    mapping: undefined,
  }

  if (serializable.mapping) {
    record.mapping = {
      nodeIdMap: new Map(Object.entries(serializable.mapping.nodeIdMap)),
      createdAt: serializable.mapping.createdAt,
    }
  }

  return record
}
