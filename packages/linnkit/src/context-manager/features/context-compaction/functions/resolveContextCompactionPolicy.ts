import {
  AgentSpecContextCompactionPolicy,
  DEFAULT_CONTEXT_COMPACTION_POLICY,
  type AgentSpecContextCompactionPolicy as AgentSpecContextCompactionPolicyValue,
  type ResolvedContextCompactionPolicy,
} from '../../../../contracts';

export function resolveContextCompactionPolicy(
  policy: AgentSpecContextCompactionPolicyValue | undefined,
): ResolvedContextCompactionPolicy {
  const resolved = {
    ...DEFAULT_CONTEXT_COMPACTION_POLICY,
    ...policy,
  };
  AgentSpecContextCompactionPolicy.parse(resolved);
  return resolved;
}
