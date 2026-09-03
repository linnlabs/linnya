import type {
  AgentSpec,
  AgentSpecContextPolicy,
  AgentSpecContextTracePolicy,
  AgentSpecSystemReminderPolicy,
  AgentSpecToolOutputPolicy,
} from '../../contracts';
import {
  DEFAULT_MUST_KEEP_POLICY,
  type MustKeepPolicy,
} from './policies';

export interface AgentContextBuilderConfigOverrides {
  DEFAULT_MAX_TOKENS?: number;
  RESERVED_FOR_RESPONSE?: number;
  WORKING_MEMORY_BUDGET_PERCENTAGE?: number;
  TOOL_PAIRING_SEARCH_RANGE?: number;
  MIN_TOOL_INTERACTIONS_TO_KEEP?: number;
  MAX_RECENT_TOOL_RUNS_TO_KEEP?: number;
  MAX_TOOL_INTERACTION_GROUPS_TO_KEEP?: number;
  AVG_CHARS_PER_TOKEN?: number;
  TOOL_CALL_OVERHEAD_TOKENS?: number;
  TOKEN_ENCODING_NAME?: string;
}

export interface AgentSpecPreprocessorOptions {
  toolHistory?: {
    strategy?: 'per-pair' | 'per-run' | 'none';
    retentionMode?: 'drop' | 'compress';
    keepLatestToolPairs?: number;
    keepLatestRuns?: number;
    maxInteractionGroups?: number;
    overflowStrategy?: 'keep-latest' | 'fail-fast';
  };
}

export interface AgentSpecProviderOptions {
  mustKeep?: MustKeepPolicy;
  contextTrace?: AgentSpecContextTracePolicy;
}

export interface AgentSpecExecutionOptions {
  toolOutput?: AgentSpecToolOutputPolicy;
}

export interface AgentSpecRuntimeOptions {
  contextBuilderConfig: AgentContextBuilderConfigOverrides;
  preprocessorOptions: AgentSpecPreprocessorOptions;
  providerOptions: AgentSpecProviderOptions;
  executionOptions: AgentSpecExecutionOptions;
  systemReminder?: AgentSpecSystemReminderPolicy;
}

/**
 * 把 AgentSpec 的上下文策略转换成 AgentContextManager 能识别的配置覆盖。
 * 注意：profileId 只用于宿主路由，这里不消费。
 */
export function agentSpecToContextBuilderConfig(
  spec: AgentSpec,
): AgentContextBuilderConfigOverrides {
  return contextPolicyToContextBuilderConfig(spec.contextPolicy);
}

export function contextPolicyToContextBuilderConfig(
  policy: AgentSpecContextPolicy,
): AgentContextBuilderConfigOverrides {
  const config: AgentContextBuilderConfigOverrides = {};
  const {
    budget,
    toolHistory,
    workingMemory,
    tokenEstimation,
  } = policy;

  if (budget?.maxTokens !== undefined) {
    config.DEFAULT_MAX_TOKENS = budget.maxTokens;
  }
  if (budget?.reservedForResponse !== undefined) {
    config.RESERVED_FOR_RESPONSE = budget.reservedForResponse;
  }
  if (budget?.workingMemoryBudgetPercentage !== undefined) {
    config.WORKING_MEMORY_BUDGET_PERCENTAGE = budget.workingMemoryBudgetPercentage;
  }
  if (toolHistory?.maxInteractionGroups !== undefined) {
    config.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP = toolHistory.maxInteractionGroups;
  }
  const maxRecentToolRuns = workingMemory?.maxRecentToolRuns ?? workingMemory?.maxRecentToolInteractions;
  if (maxRecentToolRuns !== undefined) {
    config.MAX_RECENT_TOOL_RUNS_TO_KEEP = maxRecentToolRuns;
  }
  if (workingMemory?.minToolInteractionsToKeep !== undefined) {
    config.MIN_TOOL_INTERACTIONS_TO_KEEP = workingMemory.minToolInteractionsToKeep;
  }
  if (workingMemory?.toolPairingSearchRange !== undefined) {
    config.TOOL_PAIRING_SEARCH_RANGE = workingMemory.toolPairingSearchRange;
  }
  if (tokenEstimation?.avgCharsPerToken !== undefined) {
    config.AVG_CHARS_PER_TOKEN = tokenEstimation.avgCharsPerToken;
  }
  if (tokenEstimation?.toolCallOverhead !== undefined) {
    config.TOOL_CALL_OVERHEAD_TOKENS = tokenEstimation.toolCallOverhead;
  }
  if (tokenEstimation?.encoding !== undefined) {
    config.TOKEN_ENCODING_NAME = tokenEstimation.encoding;
  }

  return config;
}

/**
 * 把 contextPolicy.toolHistory 原样转成交给 agent preprocessor registry 的配置。
 */
export function contextPolicyToPreprocessorOptions(
  policy: AgentSpecContextPolicy | undefined,
): AgentSpecPreprocessorOptions {
  const options: AgentSpecPreprocessorOptions = {};

  if (policy?.toolHistory) {
    options.toolHistory = {
      ...policy.toolHistory,
    };
  }

  return options;
}

/**
 * 提供给后续 provider registry 重建链路使用。
 * F1.2 只做映射，不在这里创建 provider，避免 shared 层反向依赖 agent profile 实现。
 */
export function contextPolicyToProviderOptions(
  policy: AgentSpecContextPolicy | undefined,
): AgentSpecProviderOptions {
  if (!policy) {
    return {};
  }

  return {
    mustKeep: contextPolicyToMustKeepPolicy(policy),
    contextTrace: policy.contextTrace,
  };
}

export function contextPolicyToMustKeepPolicy(
  policy: AgentSpecContextPolicy | undefined,
): MustKeepPolicy | undefined {
  if (!policy?.mustKeep) {
    return undefined;
  }

  return {
    alwaysKeepTypes: policy.mustKeep.alwaysKeepTypes ?? DEFAULT_MUST_KEEP_POLICY.alwaysKeepTypes,
    alwaysKeepFenceKinds: policy.mustKeep.alwaysKeepFenceKinds ?? DEFAULT_MUST_KEEP_POLICY.alwaysKeepFenceKinds,
    truncationRules: policy.mustKeep.truncationRules ?? DEFAULT_MUST_KEEP_POLICY.truncationRules,
  };
}

export function contextPolicyToSystemReminderOptions(
  policy: AgentSpecContextPolicy | undefined,
): AgentSpecSystemReminderPolicy | undefined {
  return policy?.systemReminder;
}

export function contextPolicyToExecutionOptions(
  policy: AgentSpecContextPolicy | undefined,
): AgentSpecExecutionOptions {
  if (!policy?.toolOutput) {
    return {};
  }

  return {
    toolOutput: {
      ...policy.toolOutput,
      observationGovernance: policy.toolOutput.observationGovernance
        ? { ...policy.toolOutput.observationGovernance }
        : undefined,
    },
  };
}

export function agentSpecToRuntimeOptions(spec: AgentSpec): AgentSpecRuntimeOptions {
  return contextPolicyToRuntimeOptions(spec.contextPolicy);
}

export function contextPolicyToRuntimeOptions(
  policy: AgentSpecContextPolicy,
): AgentSpecRuntimeOptions {
  return {
    contextBuilderConfig: contextPolicyToContextBuilderConfig(policy),
    preprocessorOptions: contextPolicyToPreprocessorOptions(policy),
    providerOptions: contextPolicyToProviderOptions(policy),
    executionOptions: contextPolicyToExecutionOptions(policy),
    systemReminder: contextPolicyToSystemReminderOptions(policy),
  };
}
