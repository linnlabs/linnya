import {
  AgentSpecContextPolicy,
  type AgentSpecContextPolicyInput,
  defineContextPolicy,
} from '../../contracts';

export interface MergeContextPolicyParams {
  frameworkDefault?: AgentSpecContextPolicyInput;
  hostFallback?: AgentSpecContextPolicyInput;
  agentSpec?: AgentSpecContextPolicyInput;
}

/**
 * 合并三层 contextPolicy。
 *
 * 中文备注：
 * - 优先级：frameworkDefault < hostFallback < agentSpec；
 * - 按分组做字段级合并；
 * - 数组字段整体替换，不做 concat，避免 host/agent 的规则顺序变得不可预测。
 */
export function mergeContextPolicy(params: MergeContextPolicyParams): AgentSpecContextPolicy {
  const merged = mergePolicyLayer(
    mergePolicyLayer(params.frameworkDefault, params.hostFallback),
    params.agentSpec,
  );

  return defineContextPolicy(merged);
}

function mergePolicyLayer(
  base: AgentSpecContextPolicyInput | undefined,
  override: AgentSpecContextPolicyInput | undefined,
): AgentSpecContextPolicyInput {
  if (!base && !override) {
    return {};
  }
  if (!override) {
    return { ...base };
  }
  if (!base) {
    return { ...override };
  }

  return {
    ...base,
    ...override,
    budget: mergeObject(base.budget, override.budget),
    toolHistory: mergeObject(base.toolHistory, override.toolHistory),
    toolOutput: mergeToolOutput(base.toolOutput, override.toolOutput),
    compaction: mergeObject(base.compaction, override.compaction),
    mustKeep: mergeObject(base.mustKeep, override.mustKeep),
    workingMemory: mergeObject(base.workingMemory, override.workingMemory),
    tokenEstimation: mergeTokenEstimation(base.tokenEstimation, override.tokenEstimation),
    systemReminder: mergeSystemReminder(base.systemReminder, override.systemReminder),
    contextTrace: mergeObject(base.contextTrace, override.contextTrace),
  };
}

function mergeObject<T extends object>(
  base: T | undefined,
  override: T | undefined,
): T | undefined {
  if (!base && !override) {
    return undefined;
  }
  return {
    ...base,
    ...override,
  } as T;
}

function mergeSystemReminder(
  base: AgentSpecContextPolicyInput['systemReminder'],
  override: AgentSpecContextPolicyInput['systemReminder'],
): AgentSpecContextPolicyInput['systemReminder'] {
  if (!base && !override) {
    return undefined;
  }
  return {
    ...base,
    ...override,
    thresholds: mergeObject(base?.thresholds, override?.thresholds),
    extraRules: override?.extraRules ?? base?.extraRules,
  };
}

function mergeToolOutput(
  base: AgentSpecContextPolicyInput['toolOutput'],
  override: AgentSpecContextPolicyInput['toolOutput'],
): AgentSpecContextPolicyInput['toolOutput'] {
  if (!base && !override) {
    return undefined;
  }
  return {
    ...base,
    ...override,
    observationGovernance: mergeObject(base?.observationGovernance, override?.observationGovernance),
  };
}

function mergeTokenEstimation(
  base: AgentSpecContextPolicyInput['tokenEstimation'],
  override: AgentSpecContextPolicyInput['tokenEstimation'],
): AgentSpecContextPolicyInput['tokenEstimation'] {
  if (!base && !override) {
    return undefined;
  }
  return {
    ...base,
    ...override,
    calibration: mergeObject(base?.calibration, override?.calibration),
    remoteCount: mergeObject(base?.remoteCount, override?.remoteCount),
  };
}
