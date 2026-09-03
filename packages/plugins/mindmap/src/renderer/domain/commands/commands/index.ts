/**
 * MindMap 命令体系 — 命令集导出与注册
 *
 * 中文说明：
 * - 聚合所有命令定义
 * - 提供统一的注册函数
 *
 * @module domain/commands/commands
 */

import { registerCommand } from '../registry'
import type { CommandDef } from '../types'

// 导入命令模块
import { selectionCommands } from './selectionCommands'
import { nodeCommands } from './nodeCommands'
import { reflowCommands } from './reflowCommands'
import { taggingCommands } from './taggingCommands'

// ============================================================================
// 所有命令聚合
// ============================================================================

/**
 * Phase 1 命令集
 *
 * 中文说明：
 * - 包含 selection / node / reflow / tagging 四类命令
 * - 后续 Phase 可在此扩展
 */
export const allCommands: ReadonlyArray<CommandDef<unknown>> = [
  ...selectionCommands,
  ...nodeCommands,
  ...reflowCommands,
  ...taggingCommands,
] as unknown as ReadonlyArray<CommandDef<unknown>>

// ============================================================================
// 注册函数
// ============================================================================

/**
 * 注册所有 Phase 1 命令
 *
 * 中文说明：
 * - 在 installMindMapCommands 中调用
 * - 只注册一次，重复调用会覆盖（幂等）
 */
export function registerAllCommands(): void {
  for (const cmd of allCommands) {
    registerCommand(cmd)
  }
}

// ============================================================================
// 类型导出
// ============================================================================

export type { SelectPayload, SelectManyPayload } from './selectionCommands'
export type {
  RemoveByIdsPayload,
  AddChildPayload,
  InsertSiblingPayload,
  InsertParentPayload,
  ToggleExpandPayload,
} from './nodeCommands'
export type { ReflowRequestPayload, ReflowFlushNowPayload, FlushNowReason } from './reflowCommands'
export type { SetKindPayload, SetStatusPayload, SetConfidencePayload } from './taggingCommands'
export { NODE_KIND_LABELS } from './taggingCommands'
export { NODE_KIND, type NodeKind } from '../../tagging/taggingRules'
