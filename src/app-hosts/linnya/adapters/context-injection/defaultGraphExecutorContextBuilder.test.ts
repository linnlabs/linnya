import { describe, expect, it, vi } from 'vitest';
import {
  agentContext,
  agentOrchestration,
} from 'linnkit/context-manager';
import type {
  MessageProcessingState,
  ProviderContext,
  ProviderResult,
} from 'linnkit/context-manager';
import {
  createHistorySummaryEvent,
  defineContextPolicy,
  type AiMessage,
} from 'linnkit/contracts';

vi.mock('src/domains/model-catalog', () => ({
  CLOUD_DEEPSEEK_CHAT_MODEL_ID: 'cloud-deepseek-chat',
  CLOUD_DEEPSEEK_REASONER_MODEL_ID: 'cloud-deepseek-reasoner',
  modelCatalog: {
    getModel(id: string) {
      if (id === 'cloud-deepseek-v4-flash') {
        return {
          id,
          inference_route: {
            endpoint_id: 'deepseek',
            continuation: { tool_replay: 'required' },
          },
        };
      }
      if (id === 'cloud-gemini-3-pro') {
        return {
          id,
          inference_route: {
            endpoint_id: 'google',
            continuation: { tool_replay: 'required' },
          },
        };
      }
      if (id === 'openrouter-gemini') {
        return {
          id,
          inference_route: {
            endpoint_id: 'openrouter',
            continuation: { tool_replay: 'optional' },
          },
        };
      }
      if (id === 'openai-provider-openrouter-gemini') {
        return {
          id,
          inference_route: {
            endpoint_id: 'openai',
            continuation: { tool_replay: 'unavailable' },
          },
        };
      }
      if (id === 'plain-openai') {
        return {
          id,
          model_name: 'gpt-4o-mini',
        };
      }
      if (id === 'main-model' || id === 'prepared-model') {
        return {
          id,
          inference_route: {
            endpoint_id: 'test-provider',
            context_window_tokens: 1_000,
            max_output_tokens: 100,
            continuation: { tool_replay: 'optional' },
          },
        };
      }
      if (id === 'summary-model') {
        return {
          id,
          inference_route: {
            endpoint_id: 'test-provider',
            context_window_tokens: 1_000,
            max_output_tokens: 64,
            continuation: { tool_replay: 'optional' },
          },
        };
      }
      return undefined;
    },
  },
}));

import {
  createDefaultGraphExecutorContextBuilder,
  resolveDefaultToolReplayProtocolPolicyForModel,
} from './defaultGraphExecutorContextBuilder';

const testAgentTask = {
  name: 'test-agent-task',
  buildMessages(request: { query: string }) {
    return [{
      id: 'summary-prompt',
      role: 'user' as const,
      type: 'user_input' as const,
      content: request.query,
      timestamp: 1,
    }];
  },
  processResponse(rawResponse: string) {
    return rawResponse;
  },
  processStreamChunk(chunk: string) {
    return chunk;
  },
};

const passthroughProvider = {
  name: 'PassthroughProvider',
  description: '测试用：原样保留消息',
  priority: 0,
  async provide(
    states: MessageProcessingState[],
    _availableBudget: number,
    _context: ProviderContext,
  ): Promise<ProviderResult> {
    return {
      states,
      tokensUsed: 0,
      strategiesApplied: ['passthrough_for_test'],
      stats: {
        processedCount: states.length,
        skippedCount: 0,
        addedCount: 0,
      },
    };
  },
};

const keepAllProvider = {
  ...passthroughProvider,
  name: 'KeepAllProvider',
  async provide(
    states: MessageProcessingState[],
    _availableBudget: number,
    _context: ProviderContext,
  ): Promise<ProviderResult> {
    return {
      states: states.map(state => ({ ...state, action: 'keep_core' as const })),
      tokensUsed: states.reduce((total, state) => total + state.tokens, 0),
      strategiesApplied: ['keep_all_for_test'],
      stats: {
        processedCount: states.length,
        skippedCount: 0,
        addedCount: 0,
      },
    };
  },
};

describe('resolveDefaultToolReplayProtocolPolicyForModel', () => {
  it('只按显式 route continuation 能力注入工具回放协议守卫策略', () => {
    expect(resolveDefaultToolReplayProtocolPolicyForModel('cloud-deepseek-v4-flash')).toEqual({
      provider: 'deepseek',
      requiresProviderContinuationForToolReplay: true,
    });
    expect(resolveDefaultToolReplayProtocolPolicyForModel('cloud-gemini-3-pro')).toEqual({
      provider: 'google',
      requiresProviderContinuationForToolReplay: true,
    });
    expect(resolveDefaultToolReplayProtocolPolicyForModel('openrouter-gemini')).toBeUndefined();
    expect(resolveDefaultToolReplayProtocolPolicyForModel('openai-provider-openrouter-gemini')).toBeUndefined();
  });

  it('不为普通 OpenAI 模型注入 provider replay sidecar 策略', () => {
    expect(resolveDefaultToolReplayProtocolPolicyForModel('plain-openai')).toBeUndefined();
  });
});

describe('createDefaultGraphExecutorContextBuilder', () => {
  it('默认依赖装配不应在启动阶段引用未导入的上下文策略工具', () => {
    expect(() => createDefaultGraphExecutorContextBuilder({})).not.toThrow();
  });

  it('context build 只做纯构建，不再从 Host 内部调用专用摘要模型', async () => {
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(passthroughProvider);
    const agentOrchestrator = new agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 1000,
        reservedForResponse: 100,
      },
      processing: {
        debugMode: false,
        preserveMetadata: true,
      },
      taskResolver: () => testAgentTask,
      providerRegistry,
    });
    const agentTaskResolver = vi.fn(() => testAgentTask);
    const builder = createDefaultGraphExecutorContextBuilder({
      agentOrchestrator,
      agentTaskResolver,
    });

    const result = await builder.build({
      request: {
        model_id: 'main-model',
        promptKey: 'default',
        query: '继续执行',
      },
      history: [],
      modelId: 'main-model',
      toolDefinitionTokens: 0,
    });

    expect(result.promptBudget).toEqual({
      effectiveWindowTokens: 1_000,
      outputLimitTokens: 100,
      inputBudgetTokens: 900,
      toolDefinitionTokens: 0,
      messageBudgetTokens: 900,
    });
    expect(agentTaskResolver).toHaveBeenCalledWith('default');
  });

  it('向 Graph 同时返回已解析压缩策略与主 Prompt 的稳定缓存锚点', async () => {
    const task = {
      ...testAgentTask,
      buildMessages: (_request: { query: string }, history: AiMessage[]) => [
        {
          id: 'system-main',
          role: 'system' as const,
          type: 'system_prompt' as const,
          content: 'system',
          timestamp: 1,
        },
        ...history,
        {
          id: 'user-current',
          role: 'user' as const,
          type: 'user_input' as const,
          content: '继续',
          timestamp: 3,
        },
      ],
    };
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(keepAllProvider);
    const agentOrchestrator = new agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 1_000,
        reservedForResponse: 100,
      },
      processing: {
        debugMode: false,
        preserveMetadata: true,
      },
      taskResolver: () => task,
      providerRegistry,
    });
    const builder = createDefaultGraphExecutorContextBuilder({
      agentOrchestrator,
      agentTaskResolver: () => task,
    });

    const result = await builder.build({
      request: { model_id: 'main-model', promptKey: 'default', query: '继续' },
      history: [createHistorySummaryEvent(
        'summary-old',
        'conversation-1',
        'turn-1',
        '旧事实',
        ['old-message'],
        1,
        1,
        { compression_ratio: 0.4 },
      )],
      modelId: 'main-model',
      toolDefinitionTokens: 0,
    });

    expect(result.contextCompactionPolicy).toMatchObject({
      enabled: true,
      triggerRatio: 0.8,
      targetRatio: 0.5,
    });
    expect(result.llmMessages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'system', content: '旧事实' },
      { role: 'user', content: '继续' },
    ]);
    expect(result.cachePolicy).toEqual({
      breakpoints: [
        { anchor: 'end_of_system_prompt', message_index: 0 },
        { anchor: 'end_of_history_summary', message_index: 1 },
      ],
    });
  });

  it('prepared model 与原请求不同时，预算和 Agent 上下文都只使用 prepared model', async () => {
    const buildMessages = vi.fn((request: { query: string }) => [{
      id: 'prepared-model-prompt',
      role: 'user' as const,
      type: 'user_input' as const,
      content: request.query,
      timestamp: 1,
    }]);
    const task = {
      ...testAgentTask,
      buildMessages,
    };
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(passthroughProvider);
    const agentOrchestrator = new agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 1_000,
        reservedForResponse: 100,
      },
      processing: {
        debugMode: false,
        preserveMetadata: true,
      },
      taskResolver: () => task,
      providerRegistry,
    });
    const builder = createDefaultGraphExecutorContextBuilder({
      agentOrchestrator,
      agentTaskResolver: () => task,
    });

    const result = await builder.build({
      request: {
        model_id: 'requested-model',
        promptKey: 'default',
        query: '使用已解析模型',
      },
      history: [],
      modelId: 'prepared-model',
      toolDefinitionTokens: 0,
    });

    expect(buildMessages).toHaveBeenCalledWith(expect.objectContaining({
      model_id: 'prepared-model',
      modelId: 'prepared-model',
    }), []);
    expect(result.promptBudget?.effectiveWindowTokens).toBe(1_000);
  });

  it('默认 Agent 使用 prepared model 的 256K/16K route，不受 constructor fallback 收窄', async () => {
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(passthroughProvider);
    const agentOrchestrator = new agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 8_000,
        reservedForResponse: 512,
      },
      processing: {
        debugMode: false,
        preserveMetadata: true,
      },
      taskResolver: () => testAgentTask,
      providerRegistry,
      resolveContextPolicy: () => defineContextPolicy(),
    });
    const builder = createDefaultGraphExecutorContextBuilder({
      agentOrchestrator,
      agentTaskResolver: () => testAgentTask,
      resolveModelInferenceRoute: () => ({
        context_window_tokens: 256_000,
        max_output_tokens: 16_384,
      }),
    });

    const result = await builder.build({
      request: {
        model_id: 'route-capacity-model',
        promptKey: 'default',
        query: '使用 route 容量',
      },
      history: [],
      modelId: 'route-capacity-model',
      toolDefinitionTokens: 384,
    });

    expect(result.promptBudget).toEqual({
      effectiveWindowTokens: 256_000,
      outputLimitTokens: 16_384,
      inputBudgetTokens: 239_616,
      toolDefinitionTokens: 384,
      messageBudgetTokens: 239_232,
    });
  });

  it('Agent 显式容量策略只能收窄 prepared model route', async () => {
    const providerRegistry = new agentContext.ContextProviderRegistry();
    providerRegistry.register(passthroughProvider);
    const agentOrchestrator = new agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 256_000,
        reservedForResponse: 16_384,
      },
      processing: {
        debugMode: false,
        preserveMetadata: true,
      },
      taskResolver: () => testAgentTask,
      providerRegistry,
      resolveContextPolicy: () => defineContextPolicy({
        budget: {
          maxTokens: 64_000,
          reservedForResponse: 4_096,
        },
      }),
    });
    const builder = createDefaultGraphExecutorContextBuilder({
      agentOrchestrator,
      agentTaskResolver: () => testAgentTask,
      resolveModelInferenceRoute: () => ({
        context_window_tokens: 1_000_000,
        max_output_tokens: 32_768,
      }),
    });

    const result = await builder.build({
      request: {
        model_id: 'large-route-model',
        promptKey: 'default',
        query: '使用显式 Agent cap',
      },
      history: [],
      modelId: 'large-route-model',
      toolDefinitionTokens: 1_000,
    });

    expect(result.promptBudget).toEqual({
      effectiveWindowTokens: 64_000,
      outputLimitTokens: 4_096,
      inputBudgetTokens: 59_904,
      toolDefinitionTokens: 1_000,
      messageBudgetTokens: 58_904,
    });
  });
});
