import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  GraphExecutorContextBuilder,
  GraphExecutorContextBuildOutput,
} from '../../../executorContextBuilder';
import type { TelemetryPort } from '../../../../telemetry';
import { createBuildContextStage } from '../buildContextStage';
import { createTestTickPipelineContext } from '../../__tests__/createTestTickPipelineContext';
import { runTickPipeline } from '../../runTickPipeline';
import { RunIdSchema } from '../../../../../contracts';

function createTelemetrySpy(): TelemetryPort & { emitMock: ReturnType<typeof vi.fn> } {
  const emitMock = vi.fn();
  return {
    emit: emitMock,
    emitMock,
  };
}

describe('buildContextStage telemetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('把 Tool definitions 预算交给 builder，并用统一预算限制最终模型输出', async () => {
    const contextBuilder: GraphExecutorContextBuilder = {
      build: vi.fn(
        async (): Promise<GraphExecutorContextBuildOutput> => ({
          llmMessages: [{ role: 'user', content: 'hello' }],
          promptBudget: {
            effectiveWindowTokens: 32_000,
            outputLimitTokens: 4_000,
            inputBudgetTokens: 28_000,
            toolDefinitionTokens: 1_500,
            messageBudgetTokens: 26_500,
          },
          cachePolicy: {
            breakpoints: [
              { anchor: 'end_of_system_prompt', message_index: 0 },
            ],
          },
        })
      ),
    };
    const ctx = createTestTickPipelineContext({
      context: {
        modelId: 'resolved-model',
        toolDefinitionTokens: 1_500,
        llmOptions: { reasoning_effort: 'high' },
      },
    });

    await runTickPipeline(ctx, [createBuildContextStage({ contextBuilder })]);

    expect(contextBuilder.build).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'resolved-model',
      toolDefinitionTokens: 1_500,
    }));
    expect(ctx.promptBudget?.messageBudgetTokens).toBe(26_500);
    expect(ctx.llmOptions).toMatchObject({
      reasoning_effort: 'high',
      max_tokens: 4_000,
      cache_policy: {
        breakpoints: [
          { anchor: 'end_of_system_prompt', message_index: 0 },
        ],
      },
    });
  });

  it('应把 contextTrace 收口为可序列化 JSON record', async () => {
    const contextBuilder = {
      build: vi.fn(
        async (): Promise<GraphExecutorContextBuildOutput> => ({
          llmMessages: [{ role: 'user', content: 'hello' }],
          imageInputAdmissionEvidence: {
            inputBudget: 100,
            nonImageEstimatedTokens: 10,
            initialProfileId: 'test-profile',
            attachments: [],
          },
          contextTrace: {
            kind: 'test_trace',
            messageCount: 1,
            nested: {
              kept: true,
              dropped: undefined,
            },
            skipped: () => undefined,
          },
        })
      ),
    } satisfies GraphExecutorContextBuilder;
    const ctx = createTestTickPipelineContext();

    await runTickPipeline(ctx, [createBuildContextStage({ contextBuilder })]);

    expect(ctx.contextTrace).toEqual({
      kind: 'test_trace',
      messageCount: 1,
      nested: {
        kept: true,
      },
    });
    expect(ctx.imageInputAdmissionEvidence).toEqual({
      inputBudget: 100,
      nonImageEstimatedTokens: 10,
      initialProfileId: 'test-profile',
      attachments: [],
    });
  });

  it('context builder 暴露 tokenEstimate 时发出 context_build telemetry', async () => {
    const telemetry = createTelemetrySpy();
    const contextBuilder: GraphExecutorContextBuilder = {
      build: vi.fn(
        async (): Promise<GraphExecutorContextBuildOutput> => ({
          llmMessages: [{ role: 'user', content: 'hello' }],
          tokenEstimate: {
            route: {
              capabilityId: 'openrouter',
              baseURL: 'https://openrouter.ai/api/v1',
              modelId: 'glm-via-openrouter',
              endpointModelId: 'z-ai/glm-4.5',
            },
            localEstimateTokens: 20,
            calibratedEstimateTokens: 40,
            finalTokens: 40,
            source: 'local-estimate',
            confidence: 'estimate',
          },
          tokenComponents: [
            {
              componentId: '0:user-1',
              kind: 'user',
              tokens: 40,
              source: 'local-estimate',
              confidence: 'estimate',
              messageId: 'user-1',
              kept: true,
            },
            {
              componentId: '1:old-answer',
              kind: 'assistant',
              tokens: 12,
              source: 'local-estimate',
              confidence: 'estimate',
              messageId: 'old-answer',
              kept: false,
            },
          ],
        })
      ),
    };
    const ctx = createTestTickPipelineContext({
      context: {
        telemetry,
        modelId: 'glm-via-openrouter',
        conversationId: 'conv_context_build',
        turnId: 'turn_context_build',
        input: {
          request: {
            query: '继续执行',
            promptKey: 'default',
            model_id: 'glm-via-openrouter',
          },
          history: [],
          toolContext: {
            runId: RunIdSchema.parse('run_context_build'),
            parentRunId: RunIdSchema.parse('parent_context_build'),
          },
        },
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(1_234);
    await runTickPipeline(ctx, [createBuildContextStage({ contextBuilder })]);

    expect(telemetry.emitMock).toHaveBeenCalledWith({
      kind: 'context_build',
      modelId: 'glm-via-openrouter',
      tokenEstimate: {
        route: {
          capabilityId: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          modelId: 'glm-via-openrouter',
          endpointModelId: 'z-ai/glm-4.5',
        },
        localEstimateTokens: 20,
        calibratedEstimateTokens: 40,
        finalTokens: 40,
        source: 'local-estimate',
        confidence: 'estimate',
      },
      tokenComponents: [
        {
          componentId: '0:user-1',
          kind: 'user',
          tokens: 40,
          source: 'local-estimate',
          confidence: 'estimate',
          messageId: 'user-1',
          kept: true,
        },
        {
          componentId: '1:old-answer',
          kind: 'assistant',
          tokens: 12,
          source: 'local-estimate',
          confidence: 'estimate',
          messageId: 'old-answer',
          kept: false,
        },
      ],
      tokenLedgerEntry: {
        id: expect.stringMatching(/^context-ledger-[a-f0-9]{32}$/),
        kind: 'context-component',
        conversationId: 'conv_context_build',
        runId: 'run_context_build',
        parentRunId: 'parent_context_build',
        turnId: 'turn_context_build',
        createdAt: 1_234,
        route: {
          capabilityId: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          modelId: 'glm-via-openrouter',
          endpointModelId: 'z-ai/glm-4.5',
        },
        components: [
          {
            componentId: '0:user-1',
            kind: 'user',
            tokens: 40,
            source: 'local-estimate',
            confidence: 'estimate',
            messageId: 'user-1',
            kept: true,
          },
        ],
        totalTokens: 40,
      },
      scope: {
        conversationId: 'conv_context_build',
        runId: 'run_context_build',
        parentRunId: 'parent_context_build',
        turnId: 'turn_context_build',
      },
    });
  });

});
