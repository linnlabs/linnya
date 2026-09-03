import { describe, expect, it } from 'vitest';

import type { AiMessage, RuntimeEvent, TokenRoute } from '../../../../../contracts';
import { defineContextPolicy, ToolCallIdSchema } from '../../../../../contracts';
import type { TokenCounterPort } from '../../../../../ports';
import type { IAgentTask } from '../../tasks/base';
import type {
  MessageProcessingState,
  ProviderContext,
  ProviderResult,
} from '../../context/providers';
import {
  AgentCoreContextProvider,
  AgentWorkingMemoryProvider,
  ContextProviderRegistry,
} from '../../context/providers';
import { AgentMessageOrchestrator } from '../AgentMessageOrchestrator';
import { ToolManager, type ToolManagerRegistry } from '../../tools/ToolManager';
import {
  contextPolicyToContextBuilderConfig,
  contextPolicyToProviderOptions,
} from '../../../../shared/agentSpecAdapter';
import { RuntimeEvent as RuntimeEventSchema } from '../../../../../contracts';

const keepAllProvider = {
  name: 'KeepAllProvider',
  description: '测试用：保留所有预处理后的消息',
  priority: 0,
  async provide(
    states: MessageProcessingState[],
    _availableBudget: number,
    _context: ProviderContext
  ): Promise<ProviderResult> {
    return {
      states: states.map(state => ({ ...state, action: 'keep_working_memory' })),
      tokensUsed: 0,
      strategiesApplied: ['keep_all_for_test'],
      stats: {
        processedCount: states.length,
        skippedCount: 0,
        addedCount: 0,
      },
    };
  },
};

const passThroughTask: IAgentTask = {
  name: 'pass-through',
  buildMessages(request, history): AiMessage[] {
    return [
      ...history,
      {
        id: 'current_user',
        role: 'user',
        type: 'user_input',
        content: request.query,
        timestamp: 2000,
      },
    ];
  },
  processResponse(rawResponse: string): string {
    return rawResponse;
  },
  processStreamChunk(chunk: string): string {
    return chunk;
  },
};

const testToolRegistry: ToolManagerRegistry = {
  getTool: () => undefined,
  getAvailableToolNames: () => ['workspace_read'],
  validateToolCall: () => ({ success: true }),
};

function createRemoteCountRoute(modelId: string): TokenRoute {
  return {
    capabilityId: 'test-provider',
    modelId,
    capabilities: {
      supportsRemoteTokenCount: true,
    },
  };
}

function createToolHistoryForCompression(label: string): RuntimeEvent[] {
  const longOutput = JSON.stringify({
    observation: `${label} ${'x'.repeat(600)}`,
  });
  return [
    RuntimeEventSchema.parse({
      type: 'user_input',
      id: `old_user_${label}`,
      conversation_id: `conv_${label}`,
      turn_id: `turn_${label}`,
      timestamp: 1000,
      version: 1,
      content: '历史请求',
      source: 'user',
    }),
    RuntimeEventSchema.parse({
      type: 'tool_call_decision',
      id: `old_tool_call_${label}`,
      conversation_id: `conv_${label}`,
      turn_id: `turn_${label}`,
      timestamp: 1100,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse(`call_${label}`),
      phase: 'start',
      status: 'loading',
      payload: {
        tool_calls: [
          {
            id: `call_${label}`,
            type: 'function',
            function: {
              name: 'workspace_read',
              arguments: JSON.stringify({ path: `${label}.md` }),
            },
          },
        ],
      },
    }),
    RuntimeEventSchema.parse({
      type: 'tool_output',
      id: `old_tool_output_${label}`,
      conversation_id: `conv_${label}`,
      turn_id: `turn_${label}`,
      timestamp: 1200,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse(`call_${label}`),
      status: 'success',
      observation: longOutput,
      data: {},
    }),
  ];
}

function createOrchestrator(): AgentMessageOrchestrator {
  const providerRegistry = new ContextProviderRegistry();
  providerRegistry.register(keepAllProvider);

  return new AgentMessageOrchestrator({
    tokenBudget: {
      maxTokens: 100_000,
      reservedForResponse: 1000,
    },
    processing: {
      debugMode: false,
    },
    taskResolver: () => passThroughTask,
    providerRegistry,
  });
}

function createMissingSidecarHistory(): RuntimeEvent[] {
  return [
    RuntimeEventSchema.parse({
      type: 'user_input',
      id: 'old_user',
      conversation_id: 'conv_orchestrator_sidecar',
      turn_id: 'turn_old',
      timestamp: 1000,
      version: 1,
      content: '先读文档',
      source: 'user',
    }),
    RuntimeEventSchema.parse({
      type: 'tool_call_decision',
      id: 'decision_missing_sidecar',
      conversation_id: 'conv_orchestrator_sidecar',
      turn_id: 'turn_old',
      timestamp: 1100,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse('call_missing_sidecar'),
      phase: 'start',
      status: 'loading',
      payload: {
        tool_calls: [
          {
            id: 'call_missing_sidecar',
            type: 'function',
            function: {
              name: 'workspace_read',
              arguments: JSON.stringify({ path: 'README.md' }),
            },
          },
        ],
      },
    }),
    RuntimeEventSchema.parse({
      type: 'tool_output',
      id: 'tool_output_missing_sidecar',
      conversation_id: 'conv_orchestrator_sidecar',
      turn_id: 'turn_old',
      timestamp: 1200,
      version: 1,
      tool_name: 'workspace_read',
      tool_call_id: ToolCallIdSchema.parse('call_missing_sidecar'),
      status: 'success',
      observation: 'README 内容',
      data: { content: 'README 内容' },
    }),
  ];
}

describe('AgentMessageOrchestrator provider sidecar policy', () => {
  it('不应在 linnkit 内根据 model_id 猜测 provider policy', async () => {
    const result = await createOrchestrator().processAgentConversation(
      {
        query: '继续',
        promptKey: 'default',
        model_id: 'cloud-deepseek-v4-flash',
      },
      createMissingSidecarHistory(),
      new ToolManager(testToolRegistry)
    );

    expect(result.messages.some(message => message.type === 'tool_calls')).toBe(true);
    expect(result.messages.some(message => message.type === 'tool_output')).toBe(true);
    expect(result.messages.some(message => message.metadata?.isDegradedToolReplay === true)).toBe(
      false
    );
  });

  it('应使用下游注入的 tool replay protocol policy 触发历史工具组协议守卫', async () => {
    const providerRegistry = new ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => passThroughTask,
      providerRegistry,
      resolveToolReplayProtocolPolicy: ({ modelId }) =>
        modelId === 'cloud-deepseek-v4-flash'
          ? {
              provider: 'deepseek',
              requiresProviderContinuationForToolReplay: true,
            }
          : undefined,
    });

    const processing = orchestrator.processAgentConversation(
      {
        query: '继续',
        promptKey: 'default',
        model_id: 'cloud-deepseek-v4-flash',
      },
      createMissingSidecarHistory(),
      new ToolManager(testToolRegistry)
    );

    await expect(processing).rejects.toThrow(/要求工具回放携带有序 provider continuation/);
  });
});

describe('AgentMessageOrchestrator contextPolicy provider registry', () => {
  it('按 request 的 mustKeep policy 重建 provider registry，并保留指定 fence', async () => {
    const task: IAgentTask = {
      ...passThroughTask,
      buildMessages(request): AiMessage[] {
        return [
          {
            id: 'fence_1',
            role: 'user',
            type: 'context_injection',
            content: '需要保留的上下文',
            timestamp: 1500,
            metadata: {
              fenceKind: 'additional-context',
            },
          },
          {
            id: 'current_user',
            role: 'user',
            type: 'user_input',
            content: request.query,
            timestamp: 2000,
          },
        ];
      },
    };
    const initialRegistry = new ContextProviderRegistry();
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => task,
      providerRegistry: initialRegistry,
      resolveContextPolicy: () =>
        defineContextPolicy({
          mustKeep: {
            alwaysKeepFenceKinds: ['additional-context'],
          },
        }),
      createProviderRegistry: ({ contextPolicy }) => {
        const registry = new ContextProviderRegistry();
        registry.register(
          new AgentCoreContextProvider({
            mustKeepPolicy: contextPolicyToProviderOptions(contextPolicy).mustKeep,
          })
        );
        return registry;
      },
    });

    const result = await orchestrator.processAgentConversation(
      {
        query: '继续',
        promptKey: 'default',
      },
      [],
      new ToolManager(testToolRegistry)
    );

    expect(result.messages.map(message => message.id)).toContain('fence_1');
    expect(result.messages.map(message => message.id)).toContain('current_user');
  });

  it('按 request 的 workingMemory policy 重建 provider registry，并限制历史工具组', async () => {
    const makeToolPair = (index: number): AiMessage[] => {
      const toolCallId = `call_${index}`;
      return [
        {
          id: `tool_calls_${index}`,
          role: 'assistant',
          type: 'tool_calls',
          content: '',
          timestamp: 1000 + index * 10,
          metadata: {
            tool_calls: [
              {
                id: ToolCallIdSchema.parse(toolCallId),
                type: 'function',
                function: {
                  name: 'workspace_read',
                  arguments: JSON.stringify({ path: `doc_${index}.md` }),
                },
              },
            ],
          },
        },
        {
          id: `tool_output_${index}`,
          role: 'tool',
          type: 'tool_output',
          content: `工具结果 ${index}`,
          timestamp: 1000 + index * 10 + 1,
          metadata: {
            tool_call_id: ToolCallIdSchema.parse(toolCallId),
            tool_name: 'workspace_read',
            data: { index },
          },
        },
      ];
    };
    const task: IAgentTask = {
      ...passThroughTask,
      buildMessages(request): AiMessage[] {
        return [
          ...makeToolPair(1),
          ...makeToolPair(2),
          {
            id: 'current_user',
            role: 'user',
            type: 'user_input',
            content: request.query,
            timestamp: 2000,
          },
        ];
      },
    };
    const initialRegistry = new ContextProviderRegistry();
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => task,
      providerRegistry: initialRegistry,
      resolveContextPolicy: () =>
        defineContextPolicy({
          toolHistory: {
            maxInteractionGroups: 1,
          },
          workingMemory: {
            maxRecentToolRuns: 1,
            minToolInteractionsToKeep: 0,
          },
        }),
      createProviderRegistry: ({ contextPolicy }) => {
        const registry = new ContextProviderRegistry();
        registry.register(
          new AgentWorkingMemoryProvider(
            contextPolicy ? contextPolicyToContextBuilderConfig(contextPolicy) : {}
          )
        );
        return registry;
      },
    });

    const result = await orchestrator.processAgentConversation(
      {
        query: '继续',
        promptKey: 'default',
      },
      [],
      new ToolManager(testToolRegistry)
    );
    const ids = result.messages.map(message => message.id);

    expect(ids).not.toContain('tool_calls_1');
    expect(ids).not.toContain('tool_output_1');
    expect(ids).toEqual(expect.arrayContaining(['tool_calls_2', 'tool_output_2']));
  });

  it('使用 contextPolicy.budget 作为本次上下文构建的有效预算', async () => {
    const providerRegistry = new ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 10_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => passThroughTask,
      providerRegistry,
      resolveContextPolicy: () =>
        defineContextPolicy({
          budget: {
            maxTokens: 20_000,
            reservedForResponse: 3000,
          },
          contextTrace: {
            enabled: true,
          },
        }),
    });

    const result = await orchestrator.processAgentConversation(
      {
        query: '测试预算覆盖',
        promptKey: 'default',
      },
      [],
      new ToolManager(testToolRegistry),
      {
        promptBudgetLimits: {
          modelContextWindowTokens: 128_000,
          modelMaxOutputTokens: 16_000,
          toolDefinitionTokens: 0,
        },
      },
    );

    expect(result.contextBuildResult.tokenUsage.messageBudget).toBe(17_000);
    expect(result.contextBuildResult.contextTrace?.totalBudget).toBe(17_000);
    expect(result.contextBuildResult.contextTrace?.effectivePolicy?.budget?.maxTokens).toBe(20_000);
  });

  it('Agent 未声明容量时直接使用模型 route，而不是 constructor fallback', async () => {
    const providerRegistry = new ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => passThroughTask,
      providerRegistry,
      resolveContextPolicy: () => defineContextPolicy(),
    });

    const result = await orchestrator.processAgentConversation(
      {
        query: '使用模型容量',
        promptKey: 'default',
      },
      [],
      new ToolManager(testToolRegistry),
      {
        promptBudgetLimits: {
          modelContextWindowTokens: 256_000,
          modelMaxOutputTokens: 16_384,
          toolDefinitionTokens: 384,
        },
      },
    );

    expect(result.promptBudget).toEqual({
      effectiveWindowTokens: 256_000,
      outputLimitTokens: 16_384,
      inputBudgetTokens: 239_616,
      toolDefinitionTokens: 384,
      messageBudgetTokens: 239_232,
    });
    expect(result.contextBuildResult.contextTrace).toBeUndefined();
  });

  it('按 resolveTokenRoute 注入 route-aware TokenCounterPort，不按模型名猜 route', async () => {
    const route: TokenRoute = {
      ...createRemoteCountRoute('cloud:claude-sonnet-4-6'),
      capabilityId: 'anthropic',
      baseURL: 'https://api.example.com/proxy/anthropic',
      endpointModelId: 'claude-sonnet-4-6',
    };
    const calls: Array<Parameters<TokenCounterPort['countMessages']>[0]> = [];
    const tokenCounter: TokenCounterPort = {
      countMessages: async input => {
        calls.push(input);
        return {
          inputTokens: 123,
          source: 'test-fixture',
          confidence: 'provider-estimate',
        };
      },
    };
    const providerRegistry = new ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    const orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => passThroughTask,
      providerRegistry,
      tokenCounter,
      resolveTokenRoute: ({ modelId }) =>
        modelId === 'cloud:claude-sonnet-4-6' ? route : undefined,
      resolveContextPolicy: () =>
        defineContextPolicy({
          tokenEstimation: {
            remoteCount: {
              enabled: true,
            },
          },
          contextTrace: {
            enabled: true,
          },
        }),
    });

    const result = await orchestrator.processAgentConversation(
      {
        query: '继续',
        promptKey: 'default',
        model_id: 'cloud:claude-sonnet-4-6',
      },
      [],
      new ToolManager(testToolRegistry)
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.route).toEqual(route);
    expect(result.contextBuildResult.tokenUsage.used).toBe(123);
    expect(result.contextBuildResult.tokenUsage.source).toBe('test-fixture');
    expect(result.contextBuildResult.tokenUsage.confidence).toBe('provider-estimate');
    expect(result.contextBuildResult.contextTrace?.remoteTokenCount).toMatchObject({
      enabled: true,
      attempted: true,
      applied: true,
      route,
      inputTokens: 123,
    });
  });

  it('并发请求不应通过共享 AgentContextManager 串用 token route', async () => {
    const routeA = createRemoteCountRoute('model-a');
    const routeB = createRemoteCountRoute('model-b');
    const countedRoutes: string[] = [];
    const tokenCounter: TokenCounterPort = {
      countMessages: async input => {
        countedRoutes.push(input.route.modelId);
        return {
          inputTokens: input.route.modelId === routeA.modelId ? 101 : 202,
          source: 'test-fixture',
          confidence: 'provider-estimate',
        };
      },
    };
    const providerRegistry = new ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    let orchestrator: AgentMessageOrchestrator | undefined;
    let requestB: ReturnType<AgentMessageOrchestrator['processAgentConversation']> | undefined;
    const toolRegistry: ToolManagerRegistry = {
      ...testToolRegistry,
      getTool: toolName =>
        toolName === 'workspace_read'
          ? {
              getExecutionSummary: output => {
                if (output.includes('request-a')) {
                  if (!orchestrator) {
                    throw new Error('orchestrator must be initialized before preprocessing');
                  }
                  requestB = orchestrator.processAgentConversation(
                    {
                      query: 'B',
                      promptKey: 'default',
                      model_id: routeB.modelId,
                    },
                    [],
                    new ToolManager(testToolRegistry)
                  );
                }
                return 'summary';
              },
            }
          : undefined,
    };
    orchestrator = new AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 100_000,
        reservedForResponse: 1000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => passThroughTask,
      providerRegistry,
      tokenCounter,
      resolveTokenRoute: ({ modelId }) => {
        if (modelId === routeA.modelId) return routeA;
        if (modelId === routeB.modelId) return routeB;
        return undefined;
      },
      resolveContextPolicy: () =>
        defineContextPolicy({
          tokenEstimation: {
            remoteCount: {
              enabled: true,
            },
          },
          contextTrace: {
            enabled: true,
          },
          toolHistory: {
            retentionMode: 'compress',
            keepLatestRuns: 0,
          },
        }),
    });

    const resultA = await orchestrator.processAgentConversation(
      {
        query: 'A',
        promptKey: 'default',
        model_id: routeA.modelId,
      },
      createToolHistoryForCompression('request-a'),
      new ToolManager(toolRegistry)
    );
    if (!requestB) {
      throw new Error('request B should be started from request A preprocessor');
    }
    const resultB = await requestB;

    expect(countedRoutes).toEqual(expect.arrayContaining(['model-a', 'model-b']));
    expect(resultA.contextBuildResult.contextTrace?.remoteTokenCount).toMatchObject({
      route: routeA,
      inputTokens: 101,
    });
    expect(resultB.contextBuildResult.contextTrace?.remoteTokenCount).toMatchObject({
      route: routeB,
      inputTokens: 202,
    });
  });
});
