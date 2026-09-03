import type {
  CanonicalLlmUsage,
  ContextCompactionErrorCode,
  ContextCompactionPlan,
  ContextUsageSnapshot,
  ResolvedContextCompactionPolicy,
} from '../../../../../contracts';
import type {
  ContextCompactionSuppressedReason,
  ContextCompactionTelemetryOutcome,
  TelemetryEvent,
  TelemetryScope,
} from '../../../../telemetry/telemetryPort';

export interface BuildContextCompactionTelemetryEventInput {
  modelId: string;
  policy: ResolvedContextCompactionPolicy;
  plan?: ContextCompactionPlan;
  usageBefore: ContextUsageSnapshot;
  compactionIndex: number;
  generationAttempted: boolean;
  durationMs: number;
  outcome: ContextCompactionTelemetryOutcome;
  scope: TelemetryScope;
  compactionInputTokens?: number;
  afterTokens?: number;
  summaryOutputTokens?: number;
  compressionRatio?: number;
  canonicalUsage?: CanonicalLlmUsage;
  suppressedReason?: ContextCompactionSuppressedReason;
  forcedPhaseRecovery?: boolean;
  targetUnreachable?: boolean;
  errorCode?: ContextCompactionErrorCode;
  failureReason?: string;
}

/** 只投影安全指标，绝不把 checkpoint 正文写入 telemetry。 */
export function buildContextCompactionTelemetryEvent(
  input: BuildContextCompactionTelemetryEventInput,
): Extract<TelemetryEvent, { kind: 'context_compaction' }> {
  return {
    kind: 'context_compaction',
    modelId: input.modelId,
    durationMs: input.durationMs,
    compactionIndex: input.compactionIndex,
    maxCompactionsPerRun: input.policy.maxCompactionsPerRun,
    generationAttempted: input.generationAttempted,
    triggerRatio: input.policy.triggerRatio,
    targetRatio: input.policy.targetRatio,
    beforeTokens: input.usageBefore.used_tokens,
    inputBudgetTokens: input.usageBefore.input_budget_tokens,
    ...(input.compactionInputTokens !== undefined
      ? { compactionInputTokens: input.compactionInputTokens }
      : {}),
    ...(input.afterTokens !== undefined ? { afterTokens: input.afterTokens } : {}),
    replacedMessageCount: input.plan?.replacedMessageIds.length ?? 0,
    replacedToolGroupCount: input.plan?.replacedToolGroupCount ?? 0,
    keptToolGroupCount: input.plan?.keptToolGroupCount ?? 0,
    ...(input.summaryOutputTokens !== undefined
      ? { summaryOutputTokens: input.summaryOutputTokens }
      : {}),
    ...(input.compressionRatio !== undefined
      ? { compressionRatio: input.compressionRatio }
      : {}),
    ...(input.canonicalUsage ? { canonicalUsage: input.canonicalUsage } : {}),
    outcome: input.outcome,
    ...(input.suppressedReason ? { suppressedReason: input.suppressedReason } : {}),
    forcedPhaseRecovery: input.forcedPhaseRecovery === true,
    ...(input.targetUnreachable !== undefined
      ? { targetUnreachable: input.targetUnreachable }
      : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    scope: input.scope,
  };
}
