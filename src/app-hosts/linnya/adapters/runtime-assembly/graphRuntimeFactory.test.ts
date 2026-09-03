import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llm } from '@linnlabs/linnkit/runtime-kernel';
import {
  agentTasks,
  agentContext,
  agentOrchestration,
} from '@linnlabs/linnkit/context-manager';
import { defineContextPolicy } from '@linnlabs/linnkit/contracts';
import type { AgentSpecContextPolicy, AiMessage, RuntimeEvent, TokenRoute } from '@linnlabs/linnkit/contracts';
import type {
  LlmCallOptions,
  LlmImageInputEstimatorPort,
  LlmRequestMessage,
  TokenizerPort,
} from '@linnlabs/linnkit/ports';
import type { ContextTrace } from '@linnlabs/linnkit/context-manager';

import {
  createDefaultGraphAgentExecutor,
  createDefaultGraphRuntimeDependencies,
} from './graphRuntimeFactory';
import { createDefaultGraphExecutorContextBuilder } from 'src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder';
import { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { clearRegisteredAgentTaskCache } from 'src/app-hosts/linnya/agent-registry/agentTaskResolver';

function createTokenizer(): TokenizerPort {
  return {
    estimateText: vi.fn(() => 1),
    estimateMessage: vi.fn(() => 1),
  };
}

function createSizedTokenizer(): TokenizerPort {
  return {
    estimateText: vi.fn((text) => text.length),
    estimateMessage: vi.fn((message) => String(message.content ?? '').length),
  };
}

function createLlmCaller() {
  return {
    call: vi.fn(),
    callWithRetries: vi.fn(),
  };
}

function createToolRuntime() {
  return {
    getToolSchemas: vi.fn(() => []),
    getToolDefinition: vi.fn(() => undefined)
  };
}

function createModelCatalog(models: readonly llm.ModelCatalogEntry[] = [{
  id: 'mock-model',
  inference_route: {
    context_window_tokens: 1_000,
    max_output_tokens: 100,
  },
}]): llm.ModelCatalogLike {
  return {
    getModelById: vi.fn((id: string) => models.find((model) => model.id === id)),
    getModelsByCapability: vi.fn(() => []),
    getModelsByUIVisibility: vi.fn(() => []),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContextTrace(value: unknown): value is ContextTrace {
  return isRecord(value) && value.enabled === true && Array.isArray(value.events);
}

function expectContextTrace(value: unknown): ContextTrace {
  expect(isContextTrace(value)).toBe(true);
  if (!isContextTrace(value)) {
    throw new Error('Expected context trace');
  }
  return value;
}

const calibrationRoute: TokenRoute = {
  capabilityId: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  modelId: 'calibrated-model',
  endpointModelId: 'z-ai/glm-4.5',
  capabilities: {
    supportsResponseUsage: true,
  },
};

function createHistoryEvent(input: {
  id: string;
  content: string;
  timestamp: number;
}): RuntimeEvent {
  return {
    id: input.id,
    type: 'final_answer',
    conversation_id: 'conversation-calibration',
    turn_id: 'turn-calibration-history',
    version: 1,
    answer_id: input.id,
    content: input.content,
    is_complete: true,
    completion_reason: 'terminal',
    timestamp: input.timestamp,
  };
}

function ingestActualCalibrationSample(input: {
  collector: LinnyaTokenCalibrationCollector;
  runId: string;
  localEstimateTokens: number;
  actualInputTokens: number;
  ledgerEntryId: string;
}): void {
  input.collector.ingestTelemetry({
    kind: 'context_build',
    scope: {
      runId: input.runId,
    },
    modelId: calibrationRoute.modelId,
    tokenEstimate: {
      route: calibrationRoute,
      localEstimateTokens: input.localEstimateTokens,
      calibratedEstimateTokens: input.localEstimateTokens,
      finalTokens: input.localEstimateTokens,
      source: 'local-estimate',
      confidence: 'estimate',
    },
  });

  input.collector.ingestTelemetry({
    kind: 'llm_call',
    scope: {
      runId: input.runId,
    },
    stream: false,
    durationMs: 1,
    modelId: calibrationRoute.modelId,
    tokenLedgerEntry: {
      id: input.ledgerEntryId,
      kind: 'llm-usage',
      runId: input.runId,
      modelId: calibrationRoute.modelId,
      route: calibrationRoute,
      usage: {
        inputTokens: input.actualInputTokens,
        outputTokens: 1,
        totalTokens: input.actualInputTokens + 1,
        source: 'provider-response-usage',
        confidence: 'actual',
      },
    },
  });
}

class CalibrationTestAgentTask implements agentTasks.IAgentTask {
  readonly name = 'calibration-test';

  buildMessages(request: { query: string }, history: AiMessage[]): AiMessage[] {
    return [
      {
        id: 'system-fixed',
        role: 'system',
        type: 'system_prompt',
        content: 'ssssssssssss',
        timestamp: 0,
      },
      ...history,
      {
        id: 'user-current',
        role: 'user',
        type: 'user_input',
        content: request.query,
        timestamp: 2,
      },
    ];
  }

  processResponse(rawResponse: string): string {
    return rawResponse;
  }

  processStreamChunk(chunk: string): string {
    return chunk;
  }
}

function createPassthroughAgentOrchestrator(input: {
  tokenizer: TokenizerPort;
  tokenCalibrationCollector: LinnyaTokenCalibrationCollector;
  contextPolicy: AgentSpecContextPolicy;
}): agentOrchestration.AgentMessageOrchestrator {
  const task = new CalibrationTestAgentTask();
  const providerRegistry = new agentContext.ContextProviderRegistry();
  providerRegistry.register(new agentContext.AgentCoreContextProvider());
  providerRegistry.register(new agentContext.AgentWorkingMemoryProvider({
    WORKING_MEMORY_BUDGET_PERCENTAGE: 1,
  }));

  return new agentOrchestration.AgentMessageOrchestrator({
    tokenBudget: {
      maxTokens: 45,
      reservedForResponse: 1,
    },
    processing: {
      debugMode: false,
      preserveMetadata: true,
    },
    taskResolver: () => task,
    providerRegistry,
    tokenizer: input.tokenizer,
    resolveContextPolicy: () => input.contextPolicy,
    resolveTokenRoute: () => calibrationRoute,
    resolveTokenCalibration: () => ({
      route: calibrationRoute,
      samples: input.tokenCalibrationCollector.getSamples(calibrationRoute),
    }),
  });
}

describe('graphRuntimeFactory tokenizer wiring', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
    clearRegisteredAgentTaskCache();
  });

  afterEach(() => {
    clearRegisteredAgentTaskCache();
    clearPluginRuntimeStateForTests();
  });

  it('应把同一个 tokenizer 实例同时注入 contextBuilder 和 GraphAgentExecutor', async () => {
    const tokenizer = createTokenizer();
    const llmCaller = createLlmCaller();
    const modelCatalog = createModelCatalog();
    const dependencies = createDefaultGraphRuntimeDependencies({
      tokenizer,
      llmCaller,
      toolRuntime: createToolRuntime(),
      modelCatalog,
      modelResolver: new llm.ModelResolver({ modelCatalog }),
    });

    await dependencies.contextBuilder.build({
      request: {
        model_id: 'mock-model',
        promptKey: 'default',
        query: 'hello',
      },
      history: [],
      modelId: 'mock-model',
      toolDefinitionTokens: 0,
    });

    expect(dependencies.tokenizer).toBe(tokenizer);
    expect(tokenizer.estimateMessage).toHaveBeenCalled();
  });

  it('应把 token calibration collector 注入默认 contextBuilder，让 build 可产出 context_build tokenEstimate', async () => {
    const tokenizer = createTokenizer();
    const llmCaller = createLlmCaller();
    const modelCatalog = createModelCatalog();
    const tokenCalibrationCollector = new LinnyaTokenCalibrationCollector();
    const dependencies = createDefaultGraphRuntimeDependencies({
      tokenizer,
      tokenCalibrationCollector,
      llmCaller,
      toolRuntime: createToolRuntime(),
      modelCatalog,
      modelResolver: new llm.ModelResolver({ modelCatalog }),
    });

    const result = await dependencies.contextBuilder.build({
      request: {
        model_id: 'mock-model',
        promptKey: 'default',
        query: 'hello',
      },
      history: [],
      modelId: 'mock-model',
      toolDefinitionTokens: 0,
    });

    expect(result.tokenEstimate).toMatchObject({
      localEstimateTokens: expect.any(Number),
      calibratedEstimateTokens: expect.any(Number),
      finalTokens: expect.any(Number),
      source: 'local-estimate',
      confidence: 'estimate',
    });
  });

  it('从 256K/16K model route 一路生成 Provider 输出上限和成功 Prompt 快照', async () => {
    const tokenizer = createTokenizer();
    const modelCatalog = createModelCatalog([{
      id: 'route-budget-model',
      enabled: true,
      capabilities: ['chat'],
      inference_route: {
        context_window_tokens: 256_000,
        max_output_tokens: 16_384,
      },
    }]);
    let requestedOptions: LlmCallOptions | undefined;
    const callWithRetries = vi.fn(async (
      modelId: string,
      messages: LlmRequestMessage[],
      options: LlmCallOptions,
      _eventHandler: unknown,
      _signal: unknown,
      fallbackObserver?: llm.LlmFallbackObserver,
      invocationContext?: llm.LlmCallInvocationContext,
    ) => {
      requestedOptions = options;
      const contextUsage = await invocationContext?.measurePromptUsage?.(modelId, messages);
      fallbackObserver?.onLlmAttemptSucceeded?.(modelId, contextUsage);
      return { content: '完成' };
    });
    const executor = createDefaultGraphAgentExecutor({
      tokenizer,
      llmCaller: {
        call: vi.fn(async () => ({ content: '摘要' })),
        callWithRetries,
      },
      toolRuntime: createToolRuntime(),
      modelCatalog,
      modelResolver: new llm.ModelResolver({ modelCatalog }),
    });

    const result = await executor.tick({
      request: {
        model_id: 'route-budget-model',
        promptKey: 'default',
        query: '验证完整预算链路',
        enableTools: false,
      },
      history: [],
      toolContext: {
        conversationId: 'conversation-route-budget',
        turnId: 'turn-route-budget',
      },
    });

    expect(requestedOptions?.max_tokens).toBe(16_384);
    expect(result.contextUsage).toMatchObject({
      basis: 'last_completed_llm_prompt',
      budget_model_id: 'route-budget-model',
      input_budget_tokens: 239_616,
      output_limit_tokens: 16_384,
    });
    expect(
      (result.contextUsage?.input_budget_tokens ?? 0)
      + (result.contextUsage?.output_limit_tokens ?? 0),
    ).toBe(256_000);
  });

  it('应把同一个图片 estimator 注入 Context Manager，并把预算证据透传到 graph tick 输入边界', async () => {
    const tokenizer = createTokenizer();
    const llmCaller = createLlmCaller();
    const modelCatalog = createModelCatalog();
    const llmImageInputEstimator: LlmImageInputEstimatorPort = {
      estimateImageInput: vi.fn(() => ({
        estimatedTokens: 80,
        profileId: 'test-image-profile',
        estimatorVersion: 'test-v1',
      })),
    };
    const dependencies = createDefaultGraphRuntimeDependencies({
      tokenizer,
      llmCaller,
      llmImageInputEstimator,
      toolRuntime: createToolRuntime(),
      modelCatalog,
      modelResolver: new llm.ModelResolver({ modelCatalog }),
    });

    const result = await dependencies.contextBuilder.build({
      request: {
        model_id: 'mock-model',
        promptKey: 'default',
        query: '',
        currentUserEventId: 'user-image-event',
        currentUserAttachments: [{
          id: 'attachment-1',
          kind: 'image',
          resourceId: 'asset-1',
          mediaType: 'image/png',
          byteLength: 128,
          width: 16,
          height: 8,
          sha256: 'a'.repeat(64),
        }],
      },
      history: [],
      modelId: 'mock-model',
      toolDefinitionTokens: 0,
    });

    expect(llmImageInputEstimator.estimateImageInput).toHaveBeenCalledWith(
      'mock-model',
      expect.objectContaining({
        id: 'attachment-1',
        resourceId: 'asset-1',
        placement: 'user_image',
      }),
    );
    expect(result.imageInputAdmissionEvidence).toMatchObject({
      initialProfileId: 'test-image-profile',
      attachments: [{
        id: 'attachment-1',
        resourceId: 'asset-1',
        placement: 'user_image',
        estimatedTokens: 80,
      }],
    });
  });

  it('关闭校准时基线不漂；开启且样本足够后，同 route actual 样本会改变默认 contextBuilder 的截断结果', async () => {
    const tokenizer = createSizedTokenizer();
    const llmCaller = createLlmCaller();
    const tokenCalibrationCollector = new LinnyaTokenCalibrationCollector();
    const history = [
      createHistoryEvent({
        id: 'assistant-old',
        content: 'aaaaaaaaaaaaaaaa',
        timestamp: 1,
      }),
    ];
    const request = {
      model_id: calibrationRoute.modelId,
      promptKey: 'default',
      query: 'bbbbbbbbbbbbbbbb',
    };
    const disabledBuilder = createDefaultGraphExecutorContextBuilder({
      tokenizer,
      agentOrchestrator: createPassthroughAgentOrchestrator({
        tokenizer,
        tokenCalibrationCollector,
        contextPolicy: defineContextPolicy({
          profileId: 'agent',
          budget: {
            maxTokens: 45,
            reservedForResponse: 1,
          },
          tokenEstimation: {
            calibration: {
              enabled: false,
            },
          },
          contextTrace: {
            enabled: true,
          },
        }),
      }),
      resolveModelInferenceRoute: () => ({
        context_window_tokens: 45,
        max_output_tokens: 1,
      }),
    });

    const disabledResult = await disabledBuilder.build({
      request,
      history,
      modelId: calibrationRoute.modelId,
      toolDefinitionTokens: 0,
    });

    expect(disabledResult.llmMessages.map((message) => message.content)).toContain('aaaaaaaaaaaaaaaa');
    const disabledTrace = expectContextTrace(disabledResult.contextTrace);
    expect(disabledTrace.tokenCalibration).toMatchObject({
      enabled: false,
      applied: false,
      sampleCount: 0,
    });

    for (const index of [1, 2, 3]) {
      ingestActualCalibrationSample({
        collector: tokenCalibrationCollector,
        runId: `run-${index}`,
        localEstimateTokens: 32,
        actualInputTokens: 96,
        ledgerEntryId: `ledger-${index}`,
      });
    }

    const enabledBuilder = createDefaultGraphExecutorContextBuilder({
      tokenizer,
      agentOrchestrator: createPassthroughAgentOrchestrator({
        tokenizer,
        tokenCalibrationCollector,
        contextPolicy: defineContextPolicy({
          profileId: 'agent',
          budget: {
            maxTokens: 45,
            reservedForResponse: 1,
          },
          tokenEstimation: {
            calibration: {
              enabled: true,
              minSamples: 3,
              minCoefficient: 1,
              maxCoefficient: 4,
            },
          },
          contextTrace: {
            enabled: true,
          },
        }),
      }),
      resolveModelInferenceRoute: () => ({
        context_window_tokens: 45,
        max_output_tokens: 1,
      }),
    });
    const enabledResult = await enabledBuilder.build({
      request,
      history,
      modelId: calibrationRoute.modelId,
      toolDefinitionTokens: 0,
    });

    expect(enabledResult.llmMessages.map((message) => message.content)).not.toContain('aaaaaaaaaaaaaaaa');
    const enabledTrace = expectContextTrace(enabledResult.contextTrace);
    expect(enabledTrace.tokenCalibration).toMatchObject({
      enabled: true,
      applied: true,
      coefficient: 3,
      minCoefficient: 1,
      maxCoefficient: 4,
      sampleCount: 3,
    });
    expect(enabledTrace.tokenCalibration?.coefficient).toBeGreaterThanOrEqual(1);
    expect(enabledTrace.tokenCalibration?.coefficient).toBeLessThanOrEqual(4);
    expect(enabledResult.tokenEstimate?.localEstimateTokens).not.toBe(
      enabledResult.tokenEstimate?.calibratedEstimateTokens,
    );
    const calibratedDecision = enabledTrace.events.find((event) =>
      event.kind === 'message-decision' &&
      event.tokenCalibration?.applied === true &&
      event.tokenCalibration.deltaTokens !== 0
    );
    expect(calibratedDecision).toBeDefined();
    expect(enabledTrace.truncated).toBe(true);
  });
});
