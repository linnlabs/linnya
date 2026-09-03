export const CONTEXT_COMPACTION_FAILED_ERROR_CODE =
  'llm.context.compaction_failed' as const;
export const CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE =
  'llm.context.compaction_insufficient' as const;

export type ContextCompactionErrorCode =
  | typeof CONTEXT_COMPACTION_FAILED_ERROR_CODE
  | typeof CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE;

/**
 * Context Manager 生成的纯压缩计划。
 *
 * 中文备注：计划只描述“摘要提交后替换哪些正式消息”以及本次完整 Prompt 的来源身份，
 * 不携带另一份模型输入、LLM、Provider 或事件发布能力。Graph 只消费该计划，
 * 压缩模型始终读取当前 tick 已完成 Reminder 注入的完整 Prompt。
 */
export interface ContextCompactionPlan {
  readonly fingerprint: string;
  readonly sourceMessageIds: readonly string[];
  readonly replacedMessageIds: readonly string[];
  readonly originalMessageCount: number;
  readonly includedOldSummary: boolean;
  readonly nextSummarySeq: number;
  readonly sourceTokenEstimate: number;
  readonly replacedTokenEstimate: number;
  readonly replacedToolGroupCount: number;
  readonly keptToolGroupCount: number;
  /** 当前连续可替换区段是否已全部选入；用于区分目标不可达与计划选小。 */
  readonly replaceableRangeExhausted: boolean;
}

/** Context Manager 交给 Graph 的短生命周期压缩计划。 */
export interface ContextCompactionCandidate {
  readonly plan: ContextCompactionPlan;
  readonly policy: ResolvedContextCompactionPolicy;
  readonly reminder: string;
}

/** 第一版统一的完整策略；AgentSpec optional 字段必须先解析成该形状再执行。 */
export interface ResolvedContextCompactionPolicy {
  readonly enabled: boolean;
  readonly triggerRatio: number;
  readonly targetRatio: number;
  readonly keepLatestToolGroups: number;
  readonly maxOutputTokens: number;
  readonly maxCompactionsPerRun: number;
}

export const DEFAULT_CONTEXT_COMPACTION_POLICY: ResolvedContextCompactionPolicy = {
  enabled: true,
  triggerRatio: 0.8,
  targetRatio: 0.5,
  keepLatestToolGroups: 2,
  maxOutputTokens: 8192,
  maxCompactionsPerRun: 12,
};
