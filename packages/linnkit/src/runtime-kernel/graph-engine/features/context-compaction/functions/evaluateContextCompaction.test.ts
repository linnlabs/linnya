import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_COMPACTION_POLICY, ContextUsageSnapshot } from '../../../../../contracts';
import { evaluateContextCompaction } from './evaluateContextCompaction';

function usage(usedTokens: number) {
  return ContextUsageSnapshot.parse({
    basis: 'last_completed_llm_prompt',
    budget_model_id: 'model',
    used_tokens: usedTokens,
    components: {
      system_prompt_tokens: 10,
      conversation_tokens: usedTokens - 10,
      tool_definition_tokens: 0,
    },
    component_attribution: 'normalized_local_estimate',
    input_budget_tokens: 100,
    remaining_tokens: 100 - usedTokens,
    output_limit_tokens: 20,
    source: 'local-estimate',
    confidence: 'estimate',
    measured_at: 1,
  });
}

describe('evaluateContextCompaction', () => {
  it('低于软阈值不压缩，达到阈值后执行', () => {
    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(79),
      phase: 'running',
      attemptCount: 0,
      candidateFingerprint: 'plan-a',
    })).toMatchObject({ kind: 'skip', reason: 'below_trigger' });

    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(80),
      phase: 'running',
      attemptCount: 0,
      candidateFingerprint: 'plan-a',
    })).toMatchObject({ kind: 'run', forcedPhaseRecovery: false });
  });

  it('强制收尾只抑制软触发，硬超限仍必须恢复', () => {
    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(85),
      phase: 'force_final_answer',
      attemptCount: 0,
      candidateFingerprint: 'plan-a',
    })).toMatchObject({ kind: 'skip', reason: 'forced_final_answer' });

    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(101),
      phase: 'force_final_answer',
      attemptCount: 0,
      candidateFingerprint: 'plan-a',
    })).toMatchObject({ kind: 'run', forcedPhaseRecovery: true });
  });

  it('硬超限时拒绝重复计划和超出每 run 上限', () => {
    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(101),
      phase: 'running',
      attemptCount: 1,
      lastCommittedFingerprint: 'plan-a',
      candidateFingerprint: 'plan-a',
    })).toMatchObject({ kind: 'blocked', reason: 'duplicate_plan_fingerprint' });

    expect(evaluateContextCompaction({
      policy: DEFAULT_CONTEXT_COMPACTION_POLICY,
      promptUsage: usage(101),
      phase: 'running',
      attemptCount: 12,
      candidateFingerprint: 'plan-b',
    })).toMatchObject({ kind: 'blocked', reason: 'max_compactions_reached' });
  });
});
