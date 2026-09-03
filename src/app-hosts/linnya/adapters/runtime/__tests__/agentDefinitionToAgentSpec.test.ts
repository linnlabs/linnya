import { describe, expect, it } from 'vitest';
import { PromptKeys } from '@app/schemas';
import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { runnableDefinitionToAgentSpec } from 'src/app-hosts/linnya/adapters/runtime/agentDefinitionToAgentSpec';

function createDefinition(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'default-agent',
    promptKey: PromptKeys.DEFAULT,
    defaultMode: 'agent',
    description: '测试 Agent',
    config: {
      availableTools: ['web_search', 'subagent'],
      enableTools: true,
      preferredModelCapability: 'tool_calling',
    },
    ...overrides,
  };
}

describe('runnableDefinitionToAgentSpec', () => {
  it('映射必填字段与工具白名单', () => {
    const spec = runnableDefinitionToAgentSpec(createDefinition());

    expect(spec).toMatchObject({
      id: 'default-agent',
      version: '0.0.0',
      role: 'agent',
      description: '测试 Agent',
      capabilities: ['agent', 'tools', 'tool_calling'],
      tools: [{ toolId: 'web_search' }, { toolId: 'subagent' }],
      contextPolicy: { profileId: 'agent' },
    });
    expect(spec.metadata).toMatchObject({ promptKey: PromptKeys.DEFAULT });
  });

  it('透传 contextPolicy 的工具历史与预算配置', () => {
    const spec = runnableDefinitionToAgentSpec(createDefinition({
      config: {
        availableTools: ['web_search'],
        enableTools: true,
        contextPolicy: {
          profileId: 'agent',
          budget: {
            maxTokens: 10000,
            reservedForResponse: 1200,
            workingMemoryBudgetPercentage: 0.6,
          },
          toolHistory: {
            strategy: 'per-run',
            keepLatestRuns: 2,
            keepLatestToolPairs: 0,
            maxInteractionGroups: 12,
            overflowStrategy: 'fail-fast',
          },
          compaction: {
            triggerRatio: 0.7,
            targetRatio: 0.5,
          },
        },
      },
    }));

    expect(spec.contextPolicy.toolHistory).toEqual({
      strategy: 'per-run',
      keepLatestRuns: 2,
      keepLatestToolPairs: 0,
      maxInteractionGroups: 12,
      overflowStrategy: 'fail-fast',
    });
    expect(spec.contextPolicy.budget?.maxTokens).toBe(10000);
    expect(spec.contextPolicy.compaction?.triggerRatio).toBe(0.7);
  });

  it('工具只输出可序列化 toolId，不携带运行时 schema 对象', () => {
    const spec = runnableDefinitionToAgentSpec(createDefinition());

    expect(spec.tools[0]).toEqual({ toolId: 'web_search' });
    expect(spec.tools[0]).not.toHaveProperty('argsSchema');
  });

  it('缺少可选配置时使用安全默认值', () => {
    const spec = runnableDefinitionToAgentSpec(createDefinition({
      config: undefined,
    }));

    expect(spec.capabilities).toEqual(['agent', 'tools']);
    expect(spec.tools).toEqual([]);
    expect(spec.contextPolicy).toEqual({ profileId: 'agent' });
  });
});
