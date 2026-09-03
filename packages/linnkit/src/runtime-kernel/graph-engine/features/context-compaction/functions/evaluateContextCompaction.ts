import type {
  ContextCompactionDecision,
  EvaluateContextCompactionInput,
} from '../definitions/contextCompactionDecision';

/** 只依据最终 Prompt 计量和 run-local 状态决定本 tick 是否压缩。 */
export function evaluateContextCompaction(
  input: EvaluateContextCompactionInput,
): ContextCompactionDecision {
  const usageRatio = input.promptUsage.used_tokens / input.promptUsage.input_budget_tokens;
  const hardLimitExceeded = input.promptUsage.used_tokens > input.promptUsage.input_budget_tokens;
  if (!input.policy.enabled) {
    return { kind: 'skip', reason: 'disabled', usageRatio };
  }
  if (!hardLimitExceeded && usageRatio < input.policy.triggerRatio) {
    return { kind: 'skip', reason: 'below_trigger', usageRatio };
  }
  if (!input.candidateFingerprint) {
    return hardLimitExceeded
      ? { kind: 'blocked', reason: 'no_replaceable_range', usageRatio }
      : { kind: 'skip', reason: 'no_replaceable_range', usageRatio };
  }
  if (input.attemptCount >= input.policy.maxCompactionsPerRun) {
    return hardLimitExceeded
      ? { kind: 'blocked', reason: 'max_compactions_reached', usageRatio }
      : { kind: 'skip', reason: 'max_compactions_reached', usageRatio };
  }
  if (input.lastCommittedFingerprint === input.candidateFingerprint) {
    return hardLimitExceeded
      ? { kind: 'blocked', reason: 'duplicate_plan_fingerprint', usageRatio }
      : { kind: 'skip', reason: 'duplicate_plan_fingerprint', usageRatio };
  }
  if (
    !hardLimitExceeded
    && (input.phase === 'force_final_answer' || input.phase === 'force_tools')
  ) {
    return {
      kind: 'skip',
      reason: input.phase === 'force_final_answer'
        ? 'forced_final_answer'
        : 'forced_tools',
      usageRatio,
    };
  }
  return {
    kind: 'run',
    forcedPhaseRecovery: hardLimitExceeded
      && (input.phase === 'force_final_answer' || input.phase === 'force_tools'),
    usageRatio,
  };
}
