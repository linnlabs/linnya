import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentSpec,
  ToolBindingSpec,
} from '../agentSpec';
import {
  AgentSpecContextPolicy,
  defineContextPolicy,
} from '../contextPolicy';

describe('AgentSpec contract', () => {
  it('accepts a minimal valid spec', () => {
    const result = AgentSpec.safeParse({
      id: 'hello-agent',
      version: '0.1.0',
      capabilities: [],
      tools: [],
      contextPolicy: {
        profileId: 'agent',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a complete valid spec with all contextPolicy fields', () => {
    const result = AgentSpec.safeParse({
      id: 'research-agent',
      version: '1.2.3',
      role: 'researcher',
      description: 'Runs research tasks with tool-enabled context policy.',
      capabilities: ['llm:streaming', 'tool:web-search'],
      tools: [
        {
          toolId: 'web_search',
          bindingId: 'primary-search',
          argsSchema: {
            query: { type: 'string' },
          },
          config: {
            maxResults: 5,
          },
          metadata: {
            owner: 'demo-host',
          },
        },
      ],
      contextPolicy: {
        profileId: 'agent',
        budget: {
          maxTokens: 232000,
          reservedForResponse: 2400,
          workingMemoryBudgetPercentage: 0.7,
        },
        toolHistory: {
          strategy: 'per-run',
          retentionMode: 'compress',
          keepLatestToolPairs: 2,
          keepLatestRuns: 2,
          maxInteractionGroups: 12,
          overflowStrategy: 'fail-fast',
        },
        toolOutput: {
          observationGovernance: {
            enabled: true,
            maxChars: 32000,
            maxLines: 1600,
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
          alwaysKeepTypes: ['system_prompt', 'user_input', 'tool_output'],
          alwaysKeepFenceKinds: ['project-context'],
          truncationRules: [
            {
              fenceKind: 'memory-context',
              maxBudgetFraction: 0.2,
              strategyName: 'memory-truncate',
            },
          ],
        },
        workingMemory: {
          maxRecentToolRuns: 3,
          minToolInteractionsToKeep: 2,
          toolPairingSearchRange: 12,
        },
        tokenEstimation: {
          encoding: 'cl100k_base',
          avgCharsPerToken: 2,
          toolCallOverhead: 50,
        },
        systemReminder: {
          enabledRuleIds: ['last-steps-hint'],
          thresholds: {
            toolCallStreak: 10,
            periodicReflectionPeriod: 30,
            lastStepsHintThreshold: 2,
          },
          extraRules: [
            {
              id: 'memory-density-warning',
              trigger: {
                kind: 'tool-call-streak',
                threshold: 5,
                moduloStep: true,
              },
              contentTemplate: 'memoryDensityWarning',
              contentArgs: {
                resourceName: 'memory_recall',
              },
            },
          ],
        },
        contextTrace: {
          enabled: true,
          includeMessageIds: true,
          includeTokenBreakdown: true,
          maxTraceEvents: 200,
        },
      },
      audit: {
        redactionLevel: 'standard',
        pii: true,
      },
      metadata: {
        team: 'framework',
      },
    });

    expect(result.success).toBe(true);
  });

  it('defineContextPolicy fills defaults without making minimal host policies invalid', () => {
    const explicitMinimalPolicy: AgentSpecContextPolicy = { profileId: 'agent' };
    const minimalResult = AgentSpecContextPolicy.safeParse(explicitMinimalPolicy);
    const policy = defineContextPolicy({
      toolHistory: {
        keepLatestRuns: 2,
      },
      contextTrace: {
        enabled: true,
      },
    });

    expect(minimalResult.success).toBe(true);
    expect(policy.profileId).toBe('agent');
    expect(policy.budget?.maxTokens).toBeUndefined();
    expect(policy.budget?.reservedForResponse).toBeUndefined();
    expect(policy.budget?.workingMemoryBudgetPercentage).toBe(0.7);
    expect(policy.toolHistory?.strategy).toBe('per-run');
    expect(policy.toolHistory?.retentionMode).toBe('drop');
    expect(policy.toolHistory?.keepLatestRuns).toBe(2);
    expect(policy.toolOutput?.observationGovernance).toEqual({
      enabled: true,
      maxChars: 20_000,
      maxLines: 1_200,
    });
    expect(policy.compaction?.enabled).toBe(true);
    expect(policy.mustKeep?.alwaysKeepTypes).toEqual(['system_prompt', 'user_input']);
    expect(policy.contextTrace?.enabled).toBe(true);
    expect(policy.contextTrace?.maxTraceEvents).toBe(200);
  });

  it('允许显式关闭自动上下文压缩，但省略时默认开启', () => {
    expect(defineContextPolicy().compaction?.enabled).toBe(true);
    expect(defineContextPolicy({ compaction: { enabled: false } }).compaction?.enabled).toBe(false);
  });

  it('拒绝不能达到目标占比的压缩阈值', () => {
    expect(AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      compaction: { triggerRatio: 0.8, targetRatio: 0.8 },
    }).success).toBe(false);
    expect(AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      compaction: { triggerRatio: 0.8, targetRatio: 0.9 },
    }).success).toBe(false);
    expect(AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      compaction: { triggerRatio: 0.4 },
    }).success).toBe(false);
    expect(AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      compaction: { targetRatio: 0.9 },
    }).success).toBe(false);
    expect(AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      compaction: { triggerRatio: 1 },
    }).success).toBe(false);
  });

  it('rejects invalid toolHistory strategy values', () => {
    const result = AgentSpec.safeParse({
      id: 'invalid-agent',
      version: '0.1.0',
      capabilities: [],
      tools: [],
      contextPolicy: {
        profileId: 'agent',
        toolHistory: {
          strategy: 'foo',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid overflowStrategy values', () => {
    const result = AgentSpec.safeParse({
      id: 'invalid-agent',
      version: '0.1.0',
      capabilities: [],
      tools: [],
      contextPolicy: {
        profileId: 'agent',
        toolHistory: {
          overflowStrategy: 'silent',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid toolHistory retentionMode values', () => {
    const result = AgentSpec.safeParse({
      id: 'invalid-agent',
      version: '0.1.0',
      capabilities: [],
      tools: [],
      contextPolicy: {
        profileId: 'agent',
        toolHistory: {
          retentionMode: 'archive',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects retired providerReplay fallback fields', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      providerReplay: {
        missingSidecarBehavior: 'allow',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid toolOutput observation governance limits', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      toolOutput: {
        observationGovernance: {
          maxChars: 0,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid mustKeep message types', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      mustKeep: {
        alwaysKeepTypes: ['host_private_message'],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects simultaneous enabled and disabled system reminder rule lists', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      systemReminder: {
        enabledRuleIds: ['a'],
        disabledRuleIds: ['b'],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects executable functions in system reminder content args', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      systemReminder: {
        extraRules: [
          {
            id: 'unsafe-rule',
            trigger: {
              kind: 'tool-call-streak',
              threshold: 3,
            },
            contentTemplate: 'unsafeTemplate',
            contentArgs: {
              unsafe: () => true,
            },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-finite JSON numbers in system reminder rule config and args', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      systemReminder: {
        extraRules: [
          {
            id: 'unsafe-number-rule',
            trigger: {
              kind: 'tool-call-streak',
              threshold: 3,
              config: {
                ratio: Number.POSITIVE_INFINITY,
              },
            },
            contentTemplate: 'unsafeNumberTemplate',
            contentArgs: {
              score: Number.NaN,
            },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects retired summarization policy fields', () => {
    const result = AgentSpecContextPolicy.safeParse({
      profileId: 'agent',
      summarization: {
        enabled: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects runtime zod schemas in ToolBindingSpec.argsSchema', () => {
    const result = ToolBindingSpec.safeParse({
      toolId: 'unsafe-tool',
      argsSchema: z.any(),
    });

    expect(result.success).toBe(false);
  });
});
