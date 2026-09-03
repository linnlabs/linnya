import { describe, expect, it, vi } from 'vitest';
import type { TokenCountSource } from '../../../contracts';
import type { LlmCallInvocationContext } from '../../llm';
import { GraphAgentExecutor } from '../executor';
import {
  PRIMARY_PROMPT_CAPACITY_ERROR_CODE,
  PrimaryPromptCapacityError,
} from '../definitions/primaryPromptCapacityError';

function createExecutor(input: {
  source: TokenCountSource;
  usedTokens: number;
}) {
  const callWithRetries = vi.fn(async () => ({ content: '不应调用' }));
  const eventHandler = vi.fn();
  const model = {
    id: 'primary-model',
    enabled: true,
    capabilities: ['chat'],
    inference_route: {
      context_window_tokens: 120,
      max_output_tokens: 20,
    },
    token_route: {
      capabilityId: 'test',
      modelId: 'primary-model',
      capabilities: { supportsRemoteTokenCount: true },
    },
  };
  const useRemoteCount = input.source === 'provider-preflight-count';
  const executor = new GraphAgentExecutor({
    llmCaller: { callWithRetries },
    toolRuntime: {
      getToolSchemas: () => [],
      getToolDefinition: () => undefined,
    },
    contextBuilder: {
      build: async () => ({
        llmMessages: [{ role: 'user', content: '超长 Prompt' }],
        promptBudget: {
          effectiveWindowTokens: 120,
          outputLimitTokens: 20,
          inputBudgetTokens: 100,
          toolDefinitionTokens: 0,
          messageBudgetTokens: 100,
        },
        promptUsageMeasurementPolicy: {
          token_route: model.token_route,
          remote_count_enabled: useRemoteCount,
          remote_count_failure_behavior: 'fail-fast',
        },
      }),
    },
    modelCatalog: {
      getModelById: () => model,
      getModelsByCapability: () => [model],
      getModelsByUIVisibility: () => [model],
    },
    modelResolver: { resolveModelId: () => 'primary-model' },
    tokenizer: {
      estimateText: () => 0,
      estimateMessage: () => input.usedTokens,
    },
    tokenCounter: {
      countMessages: vi.fn(async () => ({
        inputTokens: input.usedTokens,
        source: 'provider-preflight-count' as const,
        confidence: 'provider-estimate' as const,
      })),
    },
    resolveTokenRoute: () => model.token_route,
  });

  return { executor, callWithRetries, eventHandler };
}

describe('GraphAgentExecutor primary prompt capacity admission', () => {
  it.each([
    ['local-estimate' as const, false],
    ['provider-preflight-count' as const, true],
  ])('拒绝超预算的 %s Prompt，forceFinalAnswer=%s 也不能绕过', async (source, forceFinalAnswer) => {
    const { executor, callWithRetries, eventHandler } = createExecutor({
      source,
      usedTokens: 101,
    });

    const execution = executor.tick({
      request: {
        query: '继续',
        promptKey: 'default',
        model_id: 'primary-model',
        enableTools: false,
      },
      history: [],
      forceFinalAnswer,
      toolContext: {
        conversationId: 'conversation-capacity',
        turnId: 'turn-capacity',
      },
    }, eventHandler);

    await expect(execution).rejects.toMatchObject({
      name: 'PrimaryPromptCapacityError',
      errorCode: PRIMARY_PROMPT_CAPACITY_ERROR_CODE,
      recoverable: false,
      metadata: {
        modelId: 'primary-model',
        usedTokens: 101,
        inputBudgetTokens: 100,
        exceededByTokens: 1,
        source,
        confidence: source === 'provider-preflight-count' ? 'provider-estimate' : 'estimate',
      },
    } satisfies Partial<PrimaryPromptCapacityError>);
    expect(callWithRetries).not.toHaveBeenCalled();
    expect(eventHandler).not.toHaveBeenCalled();
  });

  it('fallback active route 重测后超预算，不进入 fallback Provider', async () => {
    const providerAttempts: string[] = [];
    const primaryModel = {
      id: 'primary-model',
      enabled: true,
      capabilities: ['chat'],
      inference_route: {
        context_window_tokens: 120,
        max_output_tokens: 20,
      },
      token_route: {
        capabilityId: 'primary-capability',
        modelId: 'primary-model',
        capabilities: { supportsRemoteTokenCount: true },
      },
    };
    const fallbackModel = {
      ...primaryModel,
      id: 'fallback-model',
      token_route: {
        capabilityId: 'fallback-capability',
        modelId: 'fallback-model',
        capabilities: { supportsRemoteTokenCount: true },
      },
    };
    const executor = new GraphAgentExecutor({
      llmCaller: {
        callWithRetries: vi.fn(async (
          modelId: string,
          messages,
          _options,
          _eventHandler,
          _signal,
          _fallbackObserver,
          invocationContext?: LlmCallInvocationContext,
        ) => {
          await invocationContext?.measurePromptUsage?.(modelId, messages);
          providerAttempts.push(modelId);
          await invocationContext?.measurePromptUsage?.('fallback-model', messages);
          providerAttempts.push('fallback-model');
          return { content: '不应返回' };
        }),
      },
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
      },
      contextBuilder: {
        build: async () => ({
          llmMessages: [{ role: 'user', content: '需要 fallback 的 Prompt' }],
          promptBudget: {
            effectiveWindowTokens: 120,
            outputLimitTokens: 20,
            inputBudgetTokens: 100,
            toolDefinitionTokens: 0,
            messageBudgetTokens: 100,
          },
          promptUsageMeasurementPolicy: {
            token_route: primaryModel.token_route,
            remote_count_enabled: true,
            remote_count_failure_behavior: 'fail-fast',
          },
        }),
      },
      modelCatalog: {
        getModelById: modelId => modelId === 'fallback-model' ? fallbackModel : primaryModel,
        getModelsByCapability: () => [primaryModel, fallbackModel],
        getModelsByUIVisibility: () => [primaryModel, fallbackModel],
      },
      modelResolver: { resolveModelId: () => 'primary-model' },
      tokenizer: {
        estimateText: () => 0,
        estimateMessage: () => 90,
      },
      tokenCounter: {
        countMessages: vi.fn(async request => ({
          inputTokens: request.route.modelId === 'fallback-model' ? 101 : 90,
          source: 'provider-preflight-count' as const,
          confidence: 'provider-estimate' as const,
        })),
      },
      resolveTokenRoute: modelId => modelId === 'fallback-model'
        ? fallbackModel.token_route
        : primaryModel.token_route,
    });

    await expect(executor.tick({
      request: {
        query: '继续',
        promptKey: 'default',
        model_id: 'primary-model',
        enableTools: false,
      },
      history: [],
      toolContext: {
        conversationId: 'conversation-fallback-capacity',
        turnId: 'turn-fallback-capacity',
      },
    })).rejects.toMatchObject({
      errorCode: PRIMARY_PROMPT_CAPACITY_ERROR_CODE,
      metadata: {
        modelId: 'fallback-model',
        budgetModelId: 'primary-model',
        usedTokens: 101,
        inputBudgetTokens: 100,
        exceededByTokens: 1,
        source: 'provider-preflight-count',
        confidence: 'provider-estimate',
      },
    });
    expect(providerAttempts).toEqual(['primary-model']);
  });
});
