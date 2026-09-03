import type {
  AgentSpecContextPolicy,
  AiMessage,
} from '../../../contracts';
import type { ContextTrace } from '../../../context-manager';
import type { TokenizerPort } from '../../../ports';

export type ContextPolicyInvariantId =
  | 'C1_TRACE_ENABLED_MATCHES_POLICY'
  | 'C2_EFFECTIVE_POLICY_MATCHES_EXPECTED'
  | 'C3_TRACE_OPTIONS_MATCH_POLICY'
  | 'C4_TRACE_EVENT_LIMIT'
  | 'C5_FINAL_COUNTS_MATCH_MESSAGES'
  | 'C6_FINAL_TOKENS_WITHIN_BUDGET'
  | 'C7_PROVIDER_TOKEN_DELTA'
  | 'C8_TRACE_DETAIL_OPTIONS'
  | 'C9_MESSAGE_DECISION_REASON'
  | 'C10_TOOL_PAIR_DECISIONS_STAY_TOGETHER'
  | 'C11_MUST_KEEP_TYPES_KEPT'
  | 'C12_HOST_TOKENIZER_DRIVES_BUDGET';

export interface ContextPolicyInvariantFailure {
  id: ContextPolicyInvariantId;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ContextPolicyInvariantReport {
  ok: boolean;
  failures: ContextPolicyInvariantFailure[];
}

export interface ContextPolicyInvariantContext {
  expectedPolicy?: AgentSpecContextPolicy;
  trace?: ContextTrace;
  originalMessages?: readonly AiMessage[];
  finalMessages?: readonly AiMessage[];
  tokenizer?: TokenizerPort;
  tokenizerModelId?: string;
}

export type ContextPolicyInvariantValidator = (
  context: ContextPolicyInvariantContext,
) => ContextPolicyInvariantFailure[];

export interface ValidateContextPolicyInvariantsOptions {
  enabled?: readonly ContextPolicyInvariantId[];
  disabled?: readonly ContextPolicyInvariantId[];
}
