import { describe, expect, it } from 'vitest';
import { defineContextPolicy } from '../../../contracts';
import {
  agentSpecToRuntimeOptions,
  contextPolicyToContextBuilderConfig,
  contextPolicyToExecutionOptions,
  contextPolicyToPreprocessorOptions,
  contextPolicyToProviderOptions,
  contextPolicyToSystemReminderOptions,
} from '../agentSpecAdapter';
import { mergeContextPolicy } from '../contextPolicyMerge';

describe('agentSpecAdapter', () => {
  it('maps budget, working memory and token estimation into builder config', () => {
    const policy = defineContextPolicy({
      budget: {
        maxTokens: 32000,
        reservedForResponse: 1024,
        workingMemoryBudgetPercentage: 0.6,
      },
      toolHistory: {
        maxInteractionGroups: 8,
      },
      workingMemory: {
        maxRecentToolRuns: 4,
        minToolInteractionsToKeep: 1,
        toolPairingSearchRange: 16,
      },
      tokenEstimation: {
        encoding: 'o200k_base',
        avgCharsPerToken: 1.8,
        toolCallOverhead: 70,
      },
    });

    expect(contextPolicyToContextBuilderConfig(policy)).toEqual({
      DEFAULT_MAX_TOKENS: 32000,
      RESERVED_FOR_RESPONSE: 1024,
      WORKING_MEMORY_BUDGET_PERCENTAGE: 0.6,
      MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 8,
      MAX_RECENT_TOOL_RUNS_TO_KEEP: 4,
      MIN_TOOL_INTERACTIONS_TO_KEEP: 1,
      TOOL_PAIRING_SEARCH_RANGE: 16,
      AVG_CHARS_PER_TOKEN: 1.8,
      TOOL_CALL_OVERHEAD_TOKENS: 70,
      TOKEN_ENCODING_NAME: 'o200k_base',
    });
  });

  it('keeps maxRecentToolInteractions as a deprecated alias for maxRecentToolRuns', () => {
    const policy = defineContextPolicy({
      workingMemory: {
        maxRecentToolInteractions: 5,
      },
    });

    expect(policy.workingMemory?.maxRecentToolRuns).toBe(5);
    expect(contextPolicyToContextBuilderConfig(policy)).toEqual(
      expect.objectContaining({
        MAX_RECENT_TOOL_RUNS_TO_KEEP: 5,
      }),
    );
  });

  it('prefers maxRecentToolRuns when both run and deprecated interaction fields are present', () => {
    const policy = defineContextPolicy({
      workingMemory: {
        maxRecentToolRuns: 3,
        maxRecentToolInteractions: 8,
      },
    });

    expect(policy.workingMemory?.maxRecentToolRuns).toBe(3);
    expect(policy.workingMemory?.maxRecentToolInteractions).toBe(3);
    expect(contextPolicyToContextBuilderConfig(policy)).toEqual(
      expect.objectContaining({
        MAX_RECENT_TOOL_RUNS_TO_KEEP: 3,
      }),
    );
  });

  it('maps toolHistory into preprocessor options without unrelated policy groups', () => {
    const policy = defineContextPolicy({
      toolHistory: {
        strategy: 'per-pair',
        retentionMode: 'compress',
        keepLatestToolPairs: 0,
        overflowStrategy: 'fail-fast',
      },
      workingMemory: {
        maxRecentToolRuns: 5,
      },
    });

    expect(contextPolicyToPreprocessorOptions(policy)).toEqual({
      toolHistory: expect.objectContaining({
        strategy: 'per-pair',
        retentionMode: 'compress',
        keepLatestToolPairs: 0,
        overflowStrategy: 'fail-fast',
      }),
    });
  });

  it('does not expose provider replay policy from Agent context config', () => {
    const policy = defineContextPolicy({
      toolHistory: {
        strategy: 'per-run',
      },
    });

    expect(contextPolicyToPreprocessorOptions(policy)).toEqual({
      toolHistory: expect.objectContaining({ strategy: 'per-run' }),
    });
  });

  it('maps provider and system reminder options separately', () => {
    const policy = defineContextPolicy({
      mustKeep: {
        alwaysKeepFenceKinds: ['project-context'],
      },
      contextTrace: {
        enabled: true,
      },
      systemReminder: {
        disabledRuleIds: ['periodic_progress_reflection'],
      },
    });

    expect(contextPolicyToProviderOptions(policy)).toEqual({
      mustKeep: expect.objectContaining({
        alwaysKeepFenceKinds: ['project-context'],
      }),
      contextTrace: expect.objectContaining({
        enabled: true,
      }),
    });
    expect(contextPolicyToSystemReminderOptions(policy)).toEqual(expect.objectContaining({
      disabledRuleIds: ['periodic_progress_reflection'],
    }));
  });

  it('returns all runtime option groups for an AgentSpec', () => {
    const runtimeOptions = agentSpecToRuntimeOptions({
      id: 'agent',
      version: '0.1.0',
      capabilities: [],
      tools: [],
      contextPolicy: defineContextPolicy({
        toolOutput: {
          observationGovernance: {
            enabled: true,
            maxChars: 48000,
            maxLines: 2400,
          },
        },
        contextTrace: {
          enabled: true,
        },
      }),
    });

    expect(runtimeOptions.contextBuilderConfig.DEFAULT_MAX_TOKENS).toBeUndefined();
    expect(runtimeOptions.contextBuilderConfig.RESERVED_FOR_RESPONSE).toBeUndefined();
    expect(runtimeOptions.contextBuilderConfig.WORKING_MEMORY_BUDGET_PERCENTAGE).toBe(0.7);
    expect(runtimeOptions.preprocessorOptions.toolHistory?.strategy).toBe('per-run');
    expect(runtimeOptions.preprocessorOptions.toolHistory?.retentionMode).toBe('drop');
    expect(runtimeOptions.providerOptions.contextTrace?.enabled).toBe(true);
    expect(runtimeOptions.executionOptions.toolOutput?.observationGovernance?.maxChars).toBe(48000);
    expect(runtimeOptions.systemReminder?.thresholds?.toolCallStreak).toBe(10);
  });

  it('maps toolOutput into execution options for runtime tool nodes', () => {
    const policy = defineContextPolicy({
      toolOutput: {
        observationGovernance: {
          enabled: false,
          maxChars: 1024,
          maxLines: 80,
        },
      },
    });

    expect(contextPolicyToExecutionOptions(policy)).toEqual({
      toolOutput: {
        observationGovernance: {
          enabled: false,
          maxChars: 1024,
          maxLines: 80,
        },
      },
    });
  });
});

describe('mergeContextPolicy', () => {
  it('三层均未声明容量时保留 sparse policy，不伪造 window/output cap', () => {
    const merged = mergeContextPolicy({
      frameworkDefault: {
        toolHistory: { strategy: 'per-run' },
      },
      hostFallback: {
        contextTrace: { enabled: true },
      },
      agentSpec: {
        systemReminder: { disabledRuleIds: ['periodic_progress_reflection'] },
      },
    });

    expect(merged.budget?.maxTokens).toBeUndefined();
    expect(merged.budget?.reservedForResponse).toBeUndefined();
    expect(merged.budget?.workingMemoryBudgetPercentage).toBe(0.7);
  });

  it('merges framework default, host fallback and agent spec by field priority', () => {
    const merged = mergeContextPolicy({
      frameworkDefault: {
        compaction: {
          triggerRatio: 0.8,
          targetRatio: 0.5,
        },
        budget: {
          maxTokens: 10000,
          reservedForResponse: 1000,
        },
        toolHistory: {
          strategy: 'per-pair',
          keepLatestToolPairs: 1,
        },
      },
      hostFallback: {
        compaction: {
          keepLatestToolGroups: 4,
        },
        budget: {
          reservedForResponse: 1500,
        },
        toolHistory: {
          keepLatestRuns: 2,
        },
        toolOutput: {
          observationGovernance: {
            maxChars: 20000,
            maxLines: 1200,
          },
        },
      },
      agentSpec: {
        compaction: {
          triggerRatio: 0.9,
        },
        budget: {
          maxTokens: 20000,
        },
        toolOutput: {
          observationGovernance: {
            maxLines: 400,
          },
        },
      },
    });

    expect(merged.budget?.maxTokens).toBe(20000);
    expect(merged.budget?.reservedForResponse).toBe(1500);
    expect(merged.toolHistory?.strategy).toBe('per-pair');
    expect(merged.toolHistory?.keepLatestToolPairs).toBe(1);
    expect(merged.toolHistory?.keepLatestRuns).toBe(2);
    expect(merged.toolOutput?.observationGovernance?.maxChars).toBe(20000);
    expect(merged.toolOutput?.observationGovernance?.maxLines).toBe(400);
    expect(merged.compaction).toEqual(expect.objectContaining({
      triggerRatio: 0.9,
      targetRatio: 0.5,
      keepLatestToolGroups: 4,
    }));
  });

  it('replaces arrays instead of concatenating them', () => {
    const merged = mergeContextPolicy({
      hostFallback: {
        mustKeep: {
          alwaysKeepFenceKinds: ['host-fence'],
          truncationRules: [
            {
              fenceKind: 'host-fence',
              maxBudgetFraction: 0.2,
              strategyName: 'host-truncate',
            },
          ],
        },
      },
      agentSpec: {
        mustKeep: {
          alwaysKeepFenceKinds: ['agent-fence'],
        },
      },
    });

    expect(merged.mustKeep?.alwaysKeepFenceKinds).toEqual(['agent-fence']);
    expect(merged.mustKeep?.truncationRules).toEqual([
      {
        fenceKind: 'host-fence',
        maxBudgetFraction: 0.2,
        strategyName: 'host-truncate',
      },
    ]);
  });

  it('merges system reminder thresholds field-by-field while replacing extraRules arrays', () => {
    const merged = mergeContextPolicy({
      hostFallback: {
        systemReminder: {
          thresholds: {
            toolCallStreak: 5,
            lastStepsHintThreshold: 4,
          },
          extraRules: [
            {
              id: 'host-rule',
              trigger: { kind: 'tool-call-streak', threshold: 5 },
              contentTemplate: 'hostTemplate',
            },
          ],
        },
      },
      agentSpec: {
        systemReminder: {
          thresholds: {
            lastStepsHintThreshold: 2,
          },
          extraRules: [
            {
              id: 'agent-rule',
              trigger: { kind: 'remaining-steps-leq', threshold: 2 },
              contentTemplate: 'agentTemplate',
            },
          ],
        },
      },
    });

    expect(merged.systemReminder?.thresholds).toEqual(expect.objectContaining({
      toolCallStreak: 5,
      lastStepsHintThreshold: 2,
    }));
    expect(merged.systemReminder?.extraRules).toEqual([
      {
        id: 'agent-rule',
        trigger: { kind: 'remaining-steps-leq', threshold: 2 },
        contentTemplate: 'agentTemplate',
      },
    ]);
  });

  it('merges token estimation nested calibration and remote count policies field-by-field', () => {
    const merged = mergeContextPolicy({
      hostFallback: {
        tokenEstimation: {
          encoding: 'cl100k_base',
          calibration: {
            enabled: true,
            minSamples: 3,
          },
          remoteCount: {
            failureBehavior: 'use-local-estimate',
          },
        },
      },
      agentSpec: {
        tokenEstimation: {
          remoteCount: {
            enabled: true,
          },
        },
      },
    });

    expect(merged.tokenEstimation).toEqual(expect.objectContaining({
      encoding: 'cl100k_base',
      calibration: {
        enabled: true,
        minSamples: 3,
      },
      remoteCount: {
        enabled: true,
        failureBehavior: 'use-local-estimate',
      },
    }));
  });
});
