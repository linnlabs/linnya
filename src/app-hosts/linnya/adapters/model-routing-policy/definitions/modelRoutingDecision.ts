import type { LLMPolicyErrorDecision } from 'linnkit/runtime-kernel';

export interface ModelRoutingPolicy {
  decideOnError(error: Error): LLMPolicyErrorDecision;
}
