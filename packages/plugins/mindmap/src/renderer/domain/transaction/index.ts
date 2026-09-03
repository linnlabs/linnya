/**
 * MindMap 事务体系 — 模块导出
 *
 * 中文说明：
 * - Phase 3 的事务/观测/诊断能力
 * - 提供 TxRecorder 安装与类型定义
 *
 * @module domain/transaction
 */

// 类型导出
export type {
  TxMeta,
  TxStepSource,
  TxStepMeta,
  TxOperationStep,
  TxReflowStep,
  TxCustomStep,
  TxStep,
  TxMappingRecord,
  TxStatus,
  TxRecord,
  TxRecorderOptions,
  TxRecorderInstance,
  SerializableTxRecord,
  // WP3-2: 命令层语义 Step 类型
  TxCommandStepSource,
  TxCommandStepMeta,
  TxNodeRemoveStep,
  TxNodeAddStep,
  TxNodeToggleExpandStep,
  TxNodeMoveStep,
  TxSelectionClearStep,
  TxNodeSelectStep,
  TxCommandStep,
} from './types'

// 工具函数导出
export { toSerializable, fromSerializable } from './types'

// TxRecorder 安装与辅助函数
export { installTxRecorder, markTxCompleted } from './txRecorder'

// Step 记录便捷函数（WP3-2）
export {
  recordNodeRemoveStep,
  recordNodeAddStep,
  recordNodeToggleExpandStep,
  recordNodeMoveStep,
  recordSelectionClearStep,
  recordNodeSelectStep,
} from './stepRecorder'
