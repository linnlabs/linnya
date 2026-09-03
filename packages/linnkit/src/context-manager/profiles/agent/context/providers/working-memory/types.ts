/**
 * @file src/agent/context-manager/profiles/agent/context/providers/working-memory/types.ts
 * @description 工作记忆辅助模块的共享类型定义
 */

import type { MessageProcessingState } from '../base';
import type { ToolInteractionGroup } from '../../../../../shared/toolInteractionGroup';

/**
 * 工具对适配结果
 */
export interface ToolPairFitResult {
  /** 是否可以直接装入（无需处理） */
  canFit: boolean;
  /** 工具交互组 */
  group: ToolInteractionGroup<MessageProcessingState>;
  /** 工具交互组的消息状态数组 */
  pair: MessageProcessingState[];
  /** 工具交互组的总Token数 */
  totalTokens: number;
  /** 超限原因（如果适用） */
  reason?: 'budget_exceeded';
}

/**
 * 调试日志函数类型
 */
export type DebugFn = (message: string, data?: Record<string, unknown>) => void;

/**
 * 工作记忆各子策略的统一返回形态。
 *
 * 中文备注：
 * - 子策略只负责修改 states 并返回增量统计；
 * - 总 token 与最终 ProviderResult 仍由 AgentWorkingMemoryProvider 汇总，避免职责扩散。
 */
export interface WorkingMemoryRetentionResult {
  tokensUsed: number;
  processedCount: number;
  strategiesApplied: string[];
}

export interface ToolInteractionRetentionResult extends WorkingMemoryRetentionResult {
  historicalToolGroupsKept: number;
}

export interface HistoricalToolRetentionResult extends WorkingMemoryRetentionResult {
  toolGroupsKept: number;
}

export type HistoricalToolCandidate =
  | { kind: 'compressed'; sortIndex: number; state: MessageProcessingState }
  | { kind: 'group'; sortIndex: number; group: ToolInteractionGroup<MessageProcessingState> };
