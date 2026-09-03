import type {
  AgentSpecContextPolicy,
  SerializableJsonRecord,
} from '../../contracts';
import { toSerializableJsonRecord } from '../../contracts';

const QUICKSTART_CONTEXT_POLICY_UNSUPPORTED_FIELDS = [
  'budget',
  'toolHistory',
  'toolOutput',
  'compaction',
  'mustKeep',
  'workingMemory',
  'tokenEstimation',
  'systemReminder',
  'contextTrace',
] as const satisfies readonly (keyof AgentSpecContextPolicy)[];

function listDeclaredUnsupportedFields(
  contextPolicy: AgentSpecContextPolicy,
): string[] {
  return QUICKSTART_CONTEXT_POLICY_UNSUPPORTED_FIELDS
    .filter((field) => contextPolicy[field] !== undefined);
}

export function buildQuickstartContextTrace(params: {
  agentId: string;
  messageCount: number;
  contextPolicy: AgentSpecContextPolicy;
}): SerializableJsonRecord {
  const declaredUnsupportedFields = listDeclaredUnsupportedFields(params.contextPolicy);
  const trace = {
    kind: 'quickstart_context_trace',
    agentId: params.agentId,
    messageCount: params.messageCount,
    builder: 'QuickstartContextBuilder',
    supportedSemantics: ['system_prompt', 'history_replay', 'current_user_input'],
    contextPolicyExecution: {
      profileId: params.contextPolicy.profileId,
      mode: 'quickstart_minimal',
      executed: false,
      declaredUnsupportedFields,
      note:
        'QuickstartContextBuilder only assembles system, replayable history, and current user input. Use AgentMessageOrchestrator for full contextPolicy execution.',
    },
  };

  return toSerializableJsonRecord(trace) ?? {
    kind: 'quickstart_context_trace',
    agentId: params.agentId,
    messageCount: params.messageCount,
  };
}

export function resolveQuickstartMaxSteps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return 8;
  }
  return value;
}
