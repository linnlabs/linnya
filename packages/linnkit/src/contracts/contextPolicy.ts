import { z } from 'zod';
import { SerializableJsonRecord } from './json';
import { DEFAULT_CONTEXT_COMPACTION_POLICY } from './contextCompaction';

export const AgentSpecMessageType = z.enum([
  'system_prompt',
  'history_summary',
  'context_injection',
  'user_input',
  'context_before',
  'context_after',
  'document_fragment',
  'task_request',
  'final_answer',
  'tool_code',
  'tool_calls',
  'task_completion',
  'tool_output',
]);
export type AgentSpecMessageType = z.infer<typeof AgentSpecMessageType>;

export const AgentSpecBudgetPolicy = z.object({
  maxTokens: z.number().int().positive().optional(),
  reservedForResponse: z.number().int().positive().optional(),
  workingMemoryBudgetPercentage: z.number().min(0).max(1).optional(),
});
export type AgentSpecBudgetPolicy = z.infer<typeof AgentSpecBudgetPolicy>;

export const AgentSpecToolHistoryPolicy = z.object({
  strategy: z.enum(['per-pair', 'per-run', 'none']).optional(),
  retentionMode: z.enum(['drop', 'compress']).optional(),
  keepLatestToolPairs: z.number().int().nonnegative().optional(),
  keepLatestRuns: z.number().int().nonnegative().optional(),
  maxInteractionGroups: z.number().int().nonnegative().optional(),
  overflowStrategy: z.enum(['keep-latest', 'fail-fast']).optional(),
});
export type AgentSpecToolHistoryPolicy = z.infer<typeof AgentSpecToolHistoryPolicy>;

export const AgentSpecToolObservationGovernancePolicy = z.object({
  enabled: z.boolean().optional(),
  maxChars: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().optional(),
});
export type AgentSpecToolObservationGovernancePolicy = z.infer<typeof AgentSpecToolObservationGovernancePolicy>;

export const AgentSpecToolOutputPolicy = z.object({
  observationGovernance: AgentSpecToolObservationGovernancePolicy.optional(),
});
export type AgentSpecToolOutputPolicy = z.infer<typeof AgentSpecToolOutputPolicy>;

/** Graph 在主模型调用前执行的统一上下文压缩策略。 */
export const AgentSpecContextCompactionPolicy = z.object({
  enabled: z.boolean().optional(),
  triggerRatio: z.number().gt(0).lt(1).optional(),
  targetRatio: z.number().gt(0).lt(1).optional(),
  keepLatestToolGroups: z.number().int().nonnegative().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxCompactionsPerRun: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  const triggerRatio = value.triggerRatio ?? DEFAULT_CONTEXT_COMPACTION_POLICY.triggerRatio;
  const targetRatio = value.targetRatio ?? DEFAULT_CONTEXT_COMPACTION_POLICY.targetRatio;
  if (targetRatio >= triggerRatio) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetRatio'],
      message: 'targetRatio must be lower than triggerRatio',
    });
  }
});
export type AgentSpecContextCompactionPolicy = z.infer<typeof AgentSpecContextCompactionPolicy>;

export const AgentSpecMustKeepTruncationRule = z.object({
  fenceKind: z.string().min(1),
  maxBudgetFraction: z.number().gt(0).max(1),
  strategyName: z.string().min(1),
});
export type AgentSpecMustKeepTruncationRule = z.infer<typeof AgentSpecMustKeepTruncationRule>;

export const AgentSpecMustKeepPolicy = z.object({
  alwaysKeepTypes: z.array(AgentSpecMessageType).optional(),
  alwaysKeepFenceKinds: z.array(z.string().min(1)).optional(),
  truncationRules: z.array(AgentSpecMustKeepTruncationRule).optional(),
});
export type AgentSpecMustKeepPolicy = z.infer<typeof AgentSpecMustKeepPolicy>;

export const AgentSpecWorkingMemoryPolicy = z.object({
  maxRecentToolRuns: z.number().int().nonnegative().optional(),
  /** @deprecated Use maxRecentToolRuns. Kept as a compatibility alias for older AgentSpec configs. */
  maxRecentToolInteractions: z.number().int().nonnegative().optional(),
  minToolInteractionsToKeep: z.number().int().nonnegative().optional(),
  toolPairingSearchRange: z.number().int().positive().optional(),
});
export type AgentSpecWorkingMemoryPolicy = z.infer<typeof AgentSpecWorkingMemoryPolicy>;

export const AgentSpecTokenEstimationPolicy = z.object({
  encoding: z.string().min(1).optional(),
  avgCharsPerToken: z.number().positive().optional(),
  toolCallOverhead: z.number().int().nonnegative().optional(),
  calibration: z.object({
    enabled: z.boolean().optional(),
    minSamples: z.number().int().positive().optional(),
    minCoefficient: z.number().positive().optional(),
    maxCoefficient: z.number().positive().optional(),
  }).optional(),
  remoteCount: z.object({
    enabled: z.boolean().optional(),
    failureBehavior: z.enum(['use-local-estimate', 'fail-fast']).optional(),
  }).optional(),
});
export type AgentSpecTokenEstimationPolicy = z.infer<typeof AgentSpecTokenEstimationPolicy>;

export const SYSTEM_REMINDER_BUILTIN_TRIGGER_KINDS = [
  'phase-equals',
  'remaining-steps-leq',
  'step-count-modulo',
  'tool-call-streak',
  'agent-has-tool',
] as const;

export const AgentSpecSystemReminderTrigger = z.object({
  kind: z.string().min(1),
  threshold: z.number().nonnegative().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  moduloStep: z.boolean().optional(),
  toolName: z.string().min(1).optional(),
  period: z.number().int().positive().optional(),
  minStep: z.number().int().nonnegative().optional(),
  config: SerializableJsonRecord.optional(),
});
export type AgentSpecSystemReminderTrigger = z.infer<typeof AgentSpecSystemReminderTrigger>;

export const AgentSpecSystemReminderExtraRule = z.object({
  id: z.string().min(1),
  trigger: AgentSpecSystemReminderTrigger,
  contentTemplate: z.string().min(1),
  contentArgs: SerializableJsonRecord.optional(),
});
export type AgentSpecSystemReminderExtraRule = z.infer<typeof AgentSpecSystemReminderExtraRule>;

export const AgentSpecSystemReminderPolicy = z.object({
  enabledRuleIds: z.array(z.string().min(1)).nullable().optional(),
  disabledRuleIds: z.array(z.string().min(1)).optional(),
  thresholds: z.object({
    toolCallStreak: z.number().int().nonnegative().optional(),
    periodicReflectionPeriod: z.number().int().positive().optional(),
    lastStepsHintThreshold: z.number().int().nonnegative().optional(),
  }).optional(),
  extraRules: z.array(AgentSpecSystemReminderExtraRule).optional(),
}).superRefine((value, ctx) => {
  if (value.enabledRuleIds !== undefined && value.enabledRuleIds !== null && value.disabledRuleIds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['disabledRuleIds'],
      message: 'enabledRuleIds and disabledRuleIds cannot be configured at the same time',
    });
  }
});
export type AgentSpecSystemReminderPolicy = z.infer<typeof AgentSpecSystemReminderPolicy>;

export const AgentSpecContextTracePolicy = z.object({
  enabled: z.boolean().optional(),
  includeMessageIds: z.boolean().optional(),
  includeTokenBreakdown: z.boolean().optional(),
  maxTraceEvents: z.number().int().positive().optional(),
});
export type AgentSpecContextTracePolicy = z.infer<typeof AgentSpecContextTracePolicy>;

export const AgentSpecContextPolicy = z.object({
  profileId: z.string().min(1),
  budget: AgentSpecBudgetPolicy.optional(),
  toolHistory: AgentSpecToolHistoryPolicy.optional(),
  toolOutput: AgentSpecToolOutputPolicy.optional(),
  compaction: AgentSpecContextCompactionPolicy.optional(),
  mustKeep: AgentSpecMustKeepPolicy.optional(),
  workingMemory: AgentSpecWorkingMemoryPolicy.optional(),
  tokenEstimation: AgentSpecTokenEstimationPolicy.optional(),
  systemReminder: AgentSpecSystemReminderPolicy.optional(),
  contextTrace: AgentSpecContextTracePolicy.optional(),
}).strict();
export type AgentSpecContextPolicy = z.infer<typeof AgentSpecContextPolicy>;

export type AgentSpecContextPolicyInput = Omit<z.input<typeof AgentSpecContextPolicy>, 'profileId'> & {
  profileId?: string;
};

const DEFAULT_CONTEXT_POLICY: Required<AgentSpecContextPolicy> = {
  profileId: 'agent',
  budget: {
    workingMemoryBudgetPercentage: 0.7,
  },
  toolHistory: {
    strategy: 'per-run',
    retentionMode: 'drop',
    keepLatestToolPairs: 2,
    keepLatestRuns: 1,
    maxInteractionGroups: 12,
    overflowStrategy: 'keep-latest',
  },
  toolOutput: {
    observationGovernance: {
      enabled: true,
      maxChars: 20_000,
      maxLines: 1_200,
    },
  },
  compaction: {
    enabled: true,
    triggerRatio: 0.8,
    targetRatio: 0.5,
    keepLatestToolGroups: 2,
    maxOutputTokens: 8192,
    maxCompactionsPerRun: 12,
  },
  mustKeep: {
    alwaysKeepTypes: ['system_prompt', 'user_input'],
    alwaysKeepFenceKinds: [],
    truncationRules: [],
  },
  workingMemory: {
    maxRecentToolRuns: 2,
    maxRecentToolInteractions: 2,
    minToolInteractionsToKeep: 2,
    toolPairingSearchRange: 10,
  },
  tokenEstimation: {
    encoding: 'cl100k_base',
    avgCharsPerToken: 2.0,
    toolCallOverhead: 50,
  },
  systemReminder: {
    enabledRuleIds: null,
    disabledRuleIds: [],
    thresholds: {
      toolCallStreak: 10,
      periodicReflectionPeriod: 30,
      lastStepsHintThreshold: 0,
    },
    extraRules: [],
  },
  contextTrace: {
    enabled: false,
    includeMessageIds: true,
    includeTokenBreakdown: true,
    maxTraceEvents: 200,
  },
};

/**
 * 创建完整 contextPolicy。
 *
 * 中文备注：
 * - schema 保持 optional，避免现有 host 的 `{ profileId: 'agent' }` 类型大面积变红；
 * - 框架拥有的行为策略在这里补齐；
 * - `budget.maxTokens` 与 `budget.reservedForResponse` 是 Agent 显式容量上限，
 *   未声明时必须保持缺失，让 orchestration 使用模型 route 能力。
 */
export function defineContextPolicy(input: AgentSpecContextPolicyInput = {}): AgentSpecContextPolicy {
  const merged: Required<AgentSpecContextPolicy> = {
    profileId: input.profileId ?? DEFAULT_CONTEXT_POLICY.profileId,
    budget: { ...DEFAULT_CONTEXT_POLICY.budget, ...input.budget },
    toolHistory: { ...DEFAULT_CONTEXT_POLICY.toolHistory, ...input.toolHistory },
    toolOutput: {
      ...DEFAULT_CONTEXT_POLICY.toolOutput,
      ...input.toolOutput,
      observationGovernance: {
        ...DEFAULT_CONTEXT_POLICY.toolOutput.observationGovernance,
        ...input.toolOutput?.observationGovernance,
      },
    },
    compaction: { ...DEFAULT_CONTEXT_POLICY.compaction, ...input.compaction },
    mustKeep: { ...DEFAULT_CONTEXT_POLICY.mustKeep, ...input.mustKeep },
    workingMemory: mergeWorkingMemoryPolicy(input.workingMemory),
    tokenEstimation: { ...DEFAULT_CONTEXT_POLICY.tokenEstimation, ...input.tokenEstimation },
    systemReminder: {
      ...DEFAULT_CONTEXT_POLICY.systemReminder,
      ...input.systemReminder,
      thresholds: {
        ...DEFAULT_CONTEXT_POLICY.systemReminder.thresholds,
        ...input.systemReminder?.thresholds,
      },
      extraRules: input.systemReminder?.extraRules ?? DEFAULT_CONTEXT_POLICY.systemReminder.extraRules,
    },
    contextTrace: { ...DEFAULT_CONTEXT_POLICY.contextTrace, ...input.contextTrace },
  };

  return AgentSpecContextPolicy.parse(merged);
}

function mergeWorkingMemoryPolicy(
  input: AgentSpecWorkingMemoryPolicy | undefined,
): Required<AgentSpecContextPolicy>['workingMemory'] {
  const merged = { ...DEFAULT_CONTEXT_POLICY.workingMemory, ...input };
  const resolvedRuns =
    input?.maxRecentToolRuns ??
    input?.maxRecentToolInteractions ??
    DEFAULT_CONTEXT_POLICY.workingMemory.maxRecentToolRuns;
  return {
    ...merged,
    maxRecentToolRuns: resolvedRuns,
    maxRecentToolInteractions: resolvedRuns,
  };
}
