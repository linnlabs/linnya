import type { ConversationNextRequest, HostToolCallRequestData } from '@app/schemas';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import type {
  AgentSpecSystemReminderPolicy,
  AgentSpecToolObservationGovernancePolicy,
} from '@linnlabs/linnkit/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';

export type ExecutionStartNode = 'user' | 'llm';

export interface ExecutionPolicyResult {
  executionStartNode?: ExecutionStartNode;
  hostToolCall?: HostToolCallRequestData;
  executorLocal: Record<string, unknown>;
}

export interface AssembleExecutorLocalParams {
  definition?: AgentDefinition;
  request: AgentInvokeRequest;
}

function resolveSystemReminderPolicy(definition: AgentDefinition | undefined): AgentSpecSystemReminderPolicy | undefined {
  const configured = definition?.config?.contextPolicy?.systemReminder;
  const lastStepsHintThreshold = definition?.config?.stepPolicy?.lastStepsHintThreshold;
  const nextPolicy: AgentSpecSystemReminderPolicy = {
    ...(configured ?? {}),
  };

  if (
    typeof lastStepsHintThreshold === 'number' &&
    Number.isFinite(lastStepsHintThreshold) &&
    nextPolicy.thresholds?.lastStepsHintThreshold === undefined
  ) {
    nextPolicy.thresholds = {
      ...(nextPolicy.thresholds ?? {}),
      lastStepsHintThreshold,
    };
  }

  return Object.keys(nextPolicy).length > 0 ? nextPolicy : undefined;
}

function resolveToolObservationPolicy(
  definition: AgentDefinition | undefined,
): AgentSpecToolObservationGovernancePolicy | undefined {
  const configured = definition?.config?.contextPolicy?.toolOutput?.observationGovernance;
  if (!configured) {
    return undefined;
  }

  return {
    ...(configured.enabled === undefined ? {} : { enabled: configured.enabled }),
    ...(configured.maxChars === undefined ? {} : { maxChars: configured.maxChars }),
    ...(configured.maxLines === undefined ? {} : { maxLines: configured.maxLines }),
  };
}

export function assembleExecutorLocalForDefinition(
  params: AssembleExecutorLocalParams,
): Record<string, unknown> {
  const { definition } = params;
  const executorLocal: Record<string, unknown> = {
    stepCount: 0,
  };

  const stepPolicy = definition?.config?.stepPolicy;
  if (stepPolicy) {
    executorLocal.finalStepPolicy = stepPolicy.kind;

    if (
      typeof stepPolicy.lastStepsHintThreshold === 'number' &&
      Number.isFinite(stepPolicy.lastStepsHintThreshold)
    ) {
      executorLocal.lastStepsHintThreshold = stepPolicy.lastStepsHintThreshold;
    }

    if (stepPolicy.kind === 'force_tools' && Array.isArray(stepPolicy.forcedTools)) {
      const allowedTools = Array.isArray(params.request.availableTools)
        ? new Set(params.request.availableTools.filter((item): item is string => typeof item === 'string' && item.length > 0))
        : undefined;
      const filteredTools = allowedTools
        ? stepPolicy.forcedTools.filter((name) => allowedTools.has(name))
        : [...stepPolicy.forcedTools];

      if (filteredTools.length > 0) {
        executorLocal.finalStepForcedTools = filteredTools;
      }
    }
  }

  const systemReminderPolicy = resolveSystemReminderPolicy(definition);
  if (systemReminderPolicy) {
    executorLocal.systemReminderPolicy = systemReminderPolicy;
  }

  const toolObservationPolicy = resolveToolObservationPolicy(definition);
  if (toolObservationPolicy) {
    executorLocal.toolObservationPolicy = toolObservationPolicy;
  }

  return executorLocal;
}

export function assembleExecutionPolicy(params: {
  request: AgentInvokeRequest;
  options: ConversationNextRequest['options'];
  newEvents: Array<{ type?: string }>;
}): ExecutionPolicyResult {
  const executionStartNode = params.options?.execution_start_node;
  const hostToolCall = params.options?.host_tool_call;

  const definition = findRegisteredAgentDefinitionByPromptKey(params.request.promptKey);
  const executorLocal = assembleExecutorLocalForDefinition({
    definition,
    request: params.request,
  });

  if (params.newEvents.some((event) => event.type === 'tool_output')) {
    return {
      executionStartNode: 'llm',
      hostToolCall,
      executorLocal,
    };
  }

  return {
    executionStartNode,
    hostToolCall,
    executorLocal,
  };
}
