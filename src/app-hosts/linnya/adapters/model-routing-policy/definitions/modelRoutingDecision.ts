import type { LLMPolicyErrorDecision } from '@linnlabs/linnkit/runtime-kernel';

export interface ModelRoutingPolicy {
  decideOnError(error: Error): LLMPolicyErrorDecision;
}
