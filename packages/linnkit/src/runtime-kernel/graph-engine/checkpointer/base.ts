/**
 * @file checkpointer/base.ts
 * @description Engine-state Checkpointer 接口定义。
 *
 * ## 术语：这里说的 "Checkpointer" 是哪个 checkpoint？
 *
 * 在 agent 生态里，"checkpoint" 是个被严重重载的词。这个接口指的是
 * **graph engine 的执行状态快照**——也就是 `EngineState`：
 *
 *   - `nodeId`: 图执行当前停在哪个节点
 *   - `pendingToolCalls`: 已发出还未回收的 tool call
 *   - `executorLocal.stepCount`: 循环步数计数
 *   - `local`: 节点间共享的中间字典（含 history、executorLocal 等）
 *
 * 这是 **执行控制层** 的概念：让一次 run 在被打断后能从断点恢复继续推理，
 * 让宿主能查询"我现在停在哪个节点、还欠几个 tool call"。
 *
 * ### 这个 Checkpointer **不是**：
 *
 * - **不是** 上下文压缩的事实存储。摘要仍由 LLM tick pipeline 生成并作为
 *   `history_summary` RuntimeEvent 提交；本快照只保留同一 run 的
 *   `executorLocal.contextCompaction` 计数与最近计划身份，以便 wait-user resume
 *   不会重复压缩同一段历史。
 *
 * - **不是** RuntimeEvent 持久化。事件流的持久化由 `EventStore` 接口负责。
 *
 * - **不是** Run 元数据持久化。Run 注册由 `RunRegistryStore` 负责。
 *
 * 名字相同语义不同，是历史遗留。如果你在文档里同时看到 "checkpoint"，
 * 请按上下文区分：本接口语境下的 checkpoint 永远指 EngineState 快照。
 */

import type { EngineState } from '../types';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export type CheckpointMeta = {
  checkpointKey: string;
  schemaVersion: number;
  savedAt: number;
  currentNode?: string;
  iterations?: number;
  hasPendingToolCalls: boolean;
};

export type CheckpointListFilter = {
  savedAfter?: number;
  limit?: number;
  cursor?: string;
};

export type CheckpointSummary = CheckpointMeta;

export interface Checkpointer {
  load(checkpointKey: string): Promise<EngineState | null>;
  save(checkpointKey: string, state: EngineState): Promise<void>;
  clear(checkpointKey: string): Promise<void>;
  peekMeta?(checkpointKey: string): Promise<CheckpointMeta | null>;
  list?(filter?: CheckpointListFilter): Promise<CheckpointSummary[]>;
}

export function summarizeCheckpoint(
  checkpointKey: string,
  state: EngineState,
  savedAt: number,
): CheckpointSummary {
  const local = asRecord(state.local);
  const executorLocal = asRecord(local?.executorLocal);
  const pendingToolCalls = local?.pendingToolCalls;

  return {
    checkpointKey,
    schemaVersion: state.schemaVersion ?? 1,
    savedAt,
    currentNode: state.nodeId,
    iterations:
      typeof executorLocal?.stepCount === 'number' ? executorLocal.stepCount : undefined,
    hasPendingToolCalls: Array.isArray(pendingToolCalls) && pendingToolCalls.length > 0,
  };
}
