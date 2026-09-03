import { describe, expect, it, vi } from 'vitest';
import type { LlmCallInvocationContext, LlmFallbackObserver } from '../../llm';
import type { LlmRequestMessage } from '../../../ports';
import { GraphAgentExecutor } from '../executor';

describe('GraphAgentExecutor context usage', () => {
  it('只在 provider attempt 成功后把 reminder 后的最终 Prompt 快照返回 tick', async () => {
    const countMessages = vi.fn(async () => ({
      inputTokens: 100,
      source: 'provider-preflight-count' as const,
      confidence: 'provider-estimate' as const,
    }));
    const callWithRetries = vi.fn(async (
      modelId: string,
      messages: LlmRequestMessage[],
      _options: unknown,
      _eventHandler: unknown,
      _signal: unknown,
      fallbackObserver?: LlmFallbackObserver,
      invocationContext?: LlmCallInvocationContext,
    ) => {
      const contextUsage = await invocationContext?.measurePromptUsage?.(modelId, messages);
      fallbackObserver?.onLlmAttemptSucceeded?.(modelId, contextUsage);
      return { content: '完成' };
    });
    const model = {
      id: 'main-model',
      enabled: true,
      capabilities: ['chat'],
      inference_route: {
        context_window_tokens: 1_200,
        max_output_tokens: 200,
      },
      token_route: {
        capabilityId: 'test',
        modelId: 'main-model',
        capabilities: { supportsRemoteTokenCount: true },
      },
    };
    const executor = new GraphAgentExecutor({
      llmCaller: { callWithRetries },
      toolRuntime: {
        getToolSchemas: () => [],
        getToolDefinition: () => undefined,
      },
      contextBuilder: {
        build: async () => ({
          llmMessages: [
            { role: 'system', content: '<available_skills>catalog</available_skills>' },
            { role: 'user', content: '继续' },
          ],
          promptBudget: {
            effectiveWindowTokens: 1_200,
            outputLimitTokens: 200,
            inputBudgetTokens: 1_000,
            toolDefinitionTokens: 0,
            messageBudgetTokens: 1_000,
          },
          promptUsageMeasurementPolicy: {
            token_route: model.token_route,
            remote_count_enabled: true,
            remote_count_failure_behavior: 'use-local-estimate',
          },
        }),
      },
      modelCatalog: {
        getModelById: () => model,
        getModelsByCapability: () => [model],
        getModelsByUIVisibility: () => [model],
      },
      modelResolver: { resolveModelId: () => 'main-model' },
      tokenizer: {
        estimateText: () => 0,
        estimateMessage: message => message.role === 'system' ? 20 : 80,
      },
      tokenCounter: { countMessages },
      resolveTokenRoute: () => model.token_route,
    });

    const result = await executor.tick({
      request: {
        query: '继续',
        promptKey: 'default',
        model_id: 'main-model',
        enableTools: false,
      },
      history: [],
      toolContext: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
      },
    });

    expect(result.contextUsage).toMatchObject({
      budget_model_id: 'main-model',
      used_tokens: 100,
      components: {
        system_prompt_tokens: 20,
        conversation_tokens: 80,
        tool_definition_tokens: 0,
      },
      input_budget_tokens: 1_000,
      remaining_tokens: 900,
    });
    expect(countMessages).toHaveBeenCalledOnce();
  });
});
