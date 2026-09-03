/**
 * MindMap 事务体系 — TxRecorder 聚合器
 *
 * 中文说明：
 * - 以 txId 为 key，聚合：steps、operations、reflow reasons、耗时等
 * - 监听 operation 和 geometryFlushed 事件，自动记录
 * - 不改变现有 operations ownership；不立刻替换快照 undo
 *
 * 交付物（WP3-1）：
 * - 任意一次命令执行，能输出"该 tx 下发生了哪些 operations / 哪些 reflow reasons"
 *
 * @module domain/transaction/txRecorder
 */

import type { MindMapInstance } from '../types'
import type {
  TxRecord,
  TxRecorderOptions,
  TxRecorderInstance,
  TxMeta,
  TxOperationStep,
  TxReflowStep,
  TxCommandStep,
  TxStatus,
} from './types'
import type {
  Operation,
  OperationMeta,
  LifecycleGeometryFlushedPayload,
} from '../../shared/utils/events/eventBus'
import type { ReflowReason } from '../../shared/utils/reflow/ReflowScheduler'
import { getActiveCommandContext } from '../commands/registry'
import { toSerializable } from './types'

// ============================================================================
// 配置常量
// ============================================================================

const DEFAULT_MAX_RECORDS = 100
const LOG_PREFIX = '[TxRecorder]'

// ============================================================================
// TxRecorder 实现
// ============================================================================

/**
 * 安装 TxRecorder 到 MindMap 实例
 *
 * 中文说明：
 * - 必须在 installMindMapCommands 之后调用
 * - 监听 operation 和 geometryFlushed 事件
 * - 返回 TxRecorderInstance，可用于查询和管理
 *
 * @param mind MindMap 实例
 * @param options 配置选项
 */
export function installTxRecorder(
  mind: MindMapInstance,
  options: TxRecorderOptions = {}
): TxRecorderInstance {
  const {
    debug = false,
    maxRecords = DEFAULT_MAX_RECORDS,
    recordOperations = true,
    recordReflows = true,
  } = options

  const isDev = import.meta.env.MODE !== 'production'

  // 事务记录存储（按 txId 索引）
  const records = new Map<string, TxRecord>()

  // 事务 ID 顺序（用于 LRU 清理）
  const txIdOrder: string[] = []

  // ========================================================================
  // 内部工具函数
  // ========================================================================

  /**
   * 日志输出（仅 debug 模式）
   */
  function log(message: string, data?: unknown): void {
    if (!debug || !isDev) return
    if (data !== undefined) {
      console.log(`${LOG_PREFIX} ${message}`, data)
    } else {
      console.log(`${LOG_PREFIX} ${message}`)
    }
  }

  /**
   * 警告输出（始终输出）
   */
  function warn(message: string, data?: unknown): void {
    if (!isDev) return
    if (data !== undefined) {
      console.warn(`${LOG_PREFIX} ${message}`, data)
    } else {
      console.warn(`${LOG_PREFIX} ${message}`)
    }
  }

  /**
   * 获取或创建事务记录
   *
   * 中文说明：
   * - 如果 txId 已存在，返回现有记录
   * - 如果不存在，基于当前命令上下文创建新记录
   */
  function getOrCreateRecord(txId: string): TxRecord | null {
    // 已存在的记录
    if (records.has(txId)) {
      return records.get(txId)!
    }

    // 尝试从当前命令上下文创建
    const ctx = getActiveCommandContext(mind)
    if (!ctx || ctx.txId !== txId) {
      // 没有活动上下文或 txId 不匹配，无法创建记录
      // 这种情况可能是：operation 由非命令路径触发
      return null
    }

    // 创建新记录
    const meta: TxMeta = {
      commandName: ctx.commandName,
      source: ctx.meta.source,
      traceId: ctx.meta.traceId,
      documentId: ctx.documentId,
      structureRevision: ctx.structureRevision,
      startedAt: ctx.startedAt,
    }

    const record: TxRecord = {
      txId,
      status: 'running',
      meta,
      steps: [],
      operationMetas: [],
      reflowReasons: [],
    }

    records.set(txId, record)
    txIdOrder.push(txId)

    // LRU 清理
    while (records.size > maxRecords && txIdOrder.length > 0) {
      const oldestTxId = txIdOrder.shift()
      if (oldestTxId) {
        records.delete(oldestTxId)
      }
    }

    log('Created new tx record', { txId, commandName: ctx.commandName })
    return record
  }

  /**
   * 从 Operation 提取纯 payload（移除 meta）
   */
  function extractOperationPayload(op: Operation): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { meta, ...payload } = op as Operation & { meta?: OperationMeta }
    return payload as Record<string, unknown>
  }

  // ========================================================================
  // 事件监听器
  // ========================================================================

  /**
   * 处理 operation 事件
   *
   * 中文说明：
   * - 读取 operation.meta.txId 聚合到对应的 tx 记录
   * - 如果没有 txId，归入 "unattributed"（可观测）
   */
  function handleOperation(op: Operation): void {
    if (!recordOperations) return

    const opMeta = (op as Operation & { meta?: OperationMeta }).meta
    const txId = opMeta?.txId

    if (!txId) {
      // 没有 txId，说明是非命令路径触发的 operation
      log('Unattributed operation (no txId)', { operationType: op.name })
      return
    }

    const record = getOrCreateRecord(txId)
    if (!record) {
      // 无法创建记录（可能命令已结束）
      log('Cannot associate operation to tx (context ended?)', { txId, operationType: op.name })
      return
    }

    // 记录 operation step
    const step: TxOperationStep = {
      kind: 'operation',
      operationType: op.name,
      payload: extractOperationPayload(op),
      meta: {
        at: Date.now(),
        source: 'operation',
      },
    }
    record.steps.push(step)

    // 记录 operation meta
    if (opMeta) {
      record.operationMetas.push(opMeta)
    }

    log('Recorded operation step', {
      txId,
      operationType: op.name,
      stepCount: record.steps.length,
    })
  }

  /**
   * 处理 geometryFlushed 事件
   *
   * 中文说明：
   * - 读取 payload 中的 txId/txIds 关联到对应的 tx 记录
   * - 如果没有 tx 字段，归入 "unattributed reflow"
   */
  function handleGeometryFlushed(payload: LifecycleGeometryFlushedPayload): void {
    if (!recordReflows) return

    // 扩展后的 payload 类型
    interface ExtendedPayload extends LifecycleGeometryFlushedPayload {
      txId?: string
      txIds?: string[]
    }
    const extPayload = payload as ExtendedPayload

    const txIds: string[] = []
    if (extPayload.txId) {
      txIds.push(extPayload.txId)
    } else if (extPayload.txIds && extPayload.txIds.length > 0) {
      txIds.push(...extPayload.txIds)
    }

    if (txIds.length === 0) {
      // 没有关联的 tx，归入 unattributed
      log('Unattributed reflow', { reasons: payload.reasons })
      return
    }

    // 对每个关联的 tx 记录 reflow step
    for (const txId of txIds) {
      const record = records.get(txId)
      if (!record) {
        log('Cannot associate reflow to tx (not found)', { txId, reasons: payload.reasons })
        continue
      }

      // 记录 reflow step
      const step: TxReflowStep = {
        kind: 'reflow',
        reasons: payload.reasons,
        coalescedCount: payload.coalescedCount,
        durationMs: payload.durationMs,
        meta: {
          at: payload.timestamp,
          source: 'reflow',
        },
      }
      record.steps.push(step)

      // 合并 reflow reasons
      for (const reason of payload.reasons) {
        if (!record.reflowReasons.includes(reason)) {
          record.reflowReasons.push(reason)
        }
      }

      log('Recorded reflow step', {
        txId,
        reasons: payload.reasons,
        stepCount: record.steps.length,
      })
    }

    // 警告：同一 flush 合并了多个 tx
    if (txIds.length > 1 && isDev && debug) {
      warn('Single flush coalesced multiple txs', { txIds, reasons: payload.reasons })
    }
  }

  // ========================================================================
  // 安装监听器
  // ========================================================================

  mind.bus.addListener('operation', handleOperation)
  mind.bus.addListener('lifecycle:geometryFlushed', handleGeometryFlushed)

  log('Installed', { debug, maxRecords, recordOperations, recordReflows })

  // ========================================================================
  // 公开 API
  // ========================================================================

  const instance: TxRecorderInstance = {
    getRecord(txId: string): TxRecord | undefined {
      return records.get(txId)
    },

    getRecentRecords(count = 10): TxRecord[] {
      const allTxIds = txIdOrder.slice(-count)
      return allTxIds.map((id) => records.get(id)!).filter(Boolean)
    },

    getAllRecords(): TxRecord[] {
      return Array.from(records.values())
    },

    recordCommandStep(txId: string, step: TxCommandStep): void {
      // 中文说明：
      // - command step 发生在 operation 之前，必须确保 record 已创建
      // - 使用 getOrCreateRecord 复用当前命令上下文，保证 steps 不丢
      const record = getOrCreateRecord(txId)
      if (!record) {
        log('Cannot record command step (tx not found)', { txId, stepType: step.type })
        return
      }

      record.steps.push(step)

      log('Recorded command step', {
        txId,
        stepType: step.type,
        stepCount: record.steps.length,
      })
    },

    clear(): void {
      records.clear()
      txIdOrder.length = 0
      log('Cleared all records')
    },

    dumpSummary(): void {
      if (!isDev) return

      const recentRecords = this.getRecentRecords(10)
      const summary = recentRecords.map((r) => ({
        txId: r.txId,
        commandName: r.meta.commandName,
        status: r.status,
        stepCount: r.steps.length,
        operationCount: r.operationMetas.length,
        reflowReasons: r.reflowReasons,
        durationMs: r.meta.durationMs,
      }))

      console.log(`${LOG_PREFIX} Summary (last ${recentRecords.length} txs)`, summary)
      console.table(summary)
    },

    dispose(): void {
      mind.bus.removeListener('operation', handleOperation)
      mind.bus.removeListener('lifecycle:geometryFlushed', handleGeometryFlushed)
      records.clear()
      txIdOrder.length = 0
      log('Disposed')
    },
  }

  // 注册到 mind 的 disposable 列表
  mind.disposable.push(() => {
    instance.dispose()
  })

  // 挂载到 mind.debug（仅开发态）
  if (isDev) {
    const mindDebug = (mind as unknown as { debug?: Record<string, unknown> }).debug ?? {}
    mindDebug.txRecorder = instance
    mindDebug.dumpTx = (txId: string) => {
      const record = instance.getRecord(txId)
      if (record) {
        console.log(`${LOG_PREFIX} dumpTx`, toSerializable(record))
        return record
      } else {
        console.log(`${LOG_PREFIX} dumpTx: not found`, { txId })
        return null
      }
    }
    ;(mind as unknown as { debug: Record<string, unknown> }).debug = mindDebug
  }

  return instance
}

// ============================================================================
// 辅助函数：标记事务完成/失败
// ============================================================================

/**
 * 标记事务完成
 *
 * 中文说明：
 * - 在命令 runner 结束时调用
 * - 填充 endedAt 和 durationMs
 */
export function markTxCompleted(
  recorder: TxRecorderInstance,
  txId: string,
  status: TxStatus = 'completed'
): void {
  const record = recorder.getRecord(txId)
  if (!record) return

  record.status = status
  record.meta.endedAt = Date.now()
  record.meta.durationMs = record.meta.endedAt - record.meta.startedAt
}
