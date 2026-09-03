import {
  validateC1TraceEnabledMatchesPolicy,
  validateC2EffectivePolicyMatchesExpected,
  validateC3TraceOptionsMatchPolicy,
  validateC4TraceEventLimit,
  validateC5FinalCountsMatchMessages,
  validateC6FinalTokensWithinBudget,
  validateC7ProviderTokenDelta,
  validateC8TraceDetailOptions,
  validateC9MessageDecisionReason,
  validateC10ToolPairDecisionsStayTogether,
  validateC11MustKeepTypesKept,
  validateC12HostTokenizerDrivesBudget,
} from './validators';
import type {
  ContextPolicyInvariantContext,
  ContextPolicyInvariantFailure,
  ContextPolicyInvariantId,
  ContextPolicyInvariantReport,
  ContextPolicyInvariantValidator,
  ValidateContextPolicyInvariantsOptions,
} from './types';

export type {
  ContextPolicyInvariantContext,
  ContextPolicyInvariantFailure,
  ContextPolicyInvariantId,
  ContextPolicyInvariantReport,
  ContextPolicyInvariantValidator,
  ValidateContextPolicyInvariantsOptions,
} from './types';

export {
  validateC1TraceEnabledMatchesPolicy,
  validateC2EffectivePolicyMatchesExpected,
  validateC3TraceOptionsMatchPolicy,
  validateC4TraceEventLimit,
  validateC5FinalCountsMatchMessages,
  validateC6FinalTokensWithinBudget,
  validateC7ProviderTokenDelta,
  validateC8TraceDetailOptions,
  validateC9MessageDecisionReason,
  validateC10ToolPairDecisionsStayTogether,
  validateC11MustKeepTypesKept,
  validateC12HostTokenizerDrivesBudget,
} from './validators';

const VALIDATORS = {
  C1_TRACE_ENABLED_MATCHES_POLICY: validateC1TraceEnabledMatchesPolicy,
  C2_EFFECTIVE_POLICY_MATCHES_EXPECTED: validateC2EffectivePolicyMatchesExpected,
  C3_TRACE_OPTIONS_MATCH_POLICY: validateC3TraceOptionsMatchPolicy,
  C4_TRACE_EVENT_LIMIT: validateC4TraceEventLimit,
  C5_FINAL_COUNTS_MATCH_MESSAGES: validateC5FinalCountsMatchMessages,
  C6_FINAL_TOKENS_WITHIN_BUDGET: validateC6FinalTokensWithinBudget,
  C7_PROVIDER_TOKEN_DELTA: validateC7ProviderTokenDelta,
  C8_TRACE_DETAIL_OPTIONS: validateC8TraceDetailOptions,
  C9_MESSAGE_DECISION_REASON: validateC9MessageDecisionReason,
  C10_TOOL_PAIR_DECISIONS_STAY_TOGETHER: validateC10ToolPairDecisionsStayTogether,
  C11_MUST_KEEP_TYPES_KEPT: validateC11MustKeepTypesKept,
  C12_HOST_TOKENIZER_DRIVES_BUDGET: validateC12HostTokenizerDrivesBudget,
} satisfies Record<ContextPolicyInvariantId, ContextPolicyInvariantValidator>;

export const STRICT_CONTEXT_POLICY_INVARIANT_IDS = Object.keys(VALIDATORS) as ContextPolicyInvariantId[];

export function validateContextPolicyInvariants(
  context: ContextPolicyInvariantContext,
  options: ValidateContextPolicyInvariantsOptions = {},
): ContextPolicyInvariantReport {
  const enabled = new Set(options.enabled ?? STRICT_CONTEXT_POLICY_INVARIANT_IDS);
  for (const disabledId of options.disabled ?? []) {
    enabled.delete(disabledId);
  }

  const failures: ContextPolicyInvariantFailure[] = [];
  for (const id of STRICT_CONTEXT_POLICY_INVARIANT_IDS) {
    if (!enabled.has(id)) {
      continue;
    }
    failures.push(...VALIDATORS[id](context));
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function assertContextPolicyInvariants(report: ContextPolicyInvariantReport): void {
  if (report.ok) {
    return;
  }

  const message = report.failures
    .map((item) => `${item.id} ${item.title}: ${item.message}`)
    .join('\n');
  throw new Error(`Context policy invariant check failed:\n${message}`);
}
