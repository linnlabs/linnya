import { describe, expect, it, vi } from 'vitest';

import type { AgentInvocationRequest, AuditPort, LlmRequestMessage } from '../../../../ports';
import type { TelemetryPort } from '../../../telemetry/telemetryPort';
import type {
  GraphExecutorContextBuilder,
  GraphExecutorContextBuildOutput,
} from '../../executorContextBuilder';
import { llmTelemetryMiddleware } from '../middlewares/llmTelemetryMiddleware';
import { runModelLockMiddleware } from '../middlewares/runModelLockMiddleware';
import { runTickPipeline } from '../runTickPipeline';
import { createApplySystemReminderStage } from '../stages/applySystemReminderStage';
import { createBuildContextStage } from '../stages/buildContextStage';
import { createBuildDecisionStage } from '../stages/buildDecisionStage';
import { createExecuteLlmStage } from '../stages/executeLlmStage';
import { createPrepareCallStage } from '../stages/prepareCallStage';
import type { TickPipelineContext } from '../types';
import { createTestTickPipelineContext } from './createTestTickPipelineContext';
import { RunIdSchema } from '../../../../contracts';
import type { FunctionToolSchema } from '../../../tools/toolContracts';

function createRequest(): AgentInvocationRequest {
  return {
    query: 'side effect isolation',
    promptKey: 'side-effect-contract',
    model_id: 'contract-model',
    maxSteps: 8,
    enableTools: true,
    availableTools: ['mock_tool'],
  };
}

function createContextBuilder(): GraphExecutorContextBuilder {
  return {
    async build(): Promise<GraphExecutorContextBuildOutput> {
      const llmMessages: LlmRequestMessage[] = [
        { role: 'system', content: 'You are a deterministic contract test assistant.' },
        { role: 'user', content: 'side effect isolation' },
      ];
      return {
        llmMessages,
        contextTrace: {
          kind: 'side-effect-contract',
          providerCount: 1,
        },
      };
    },
  };
}

function createAuditSpy(): AuditPort & {
  emitMock: ReturnType<typeof vi.fn>;
} {
  const emitMock = vi.fn();
  return {
    emit: emitMock,
    emitMock,
  };
}

function createTelemetrySpy(): TelemetryPort & {
  emitMock: ReturnType<typeof vi.fn>;
} {
  const emitMock = vi.fn();
  return {
    emit: emitMock,
    emitMock,
  };
}

function createContext(options: {
  audit: AuditPort;
  telemetry: TelemetryPort;
}): TickPipelineContext {
  const request = createRequest();
  return createTestTickPipelineContext({
    request,
    context: {
      input: {
        request,
        history: [],
        stream: false,
        toolContext: {
          runId: RunIdSchema.parse('run_side_effect'),
          parentRunId: RunIdSchema.parse('parent_side_effect'),
        },
      },
      request,
      history: [],
      modelId: '',
      conversationId: 'conv_side_effect',
      turnId: 'turn_side_effect',
      audit: options.audit,
      telemetry: options.telemetry,
    },
  });
}

describe('tick pipeline side-effect isolation baseline', () => {
  it('通过显式 Port 出口记录小型 audit 与 LLM telemetry 的副作用形状', async () => {
    const audit = createAuditSpy();
    const telemetry = createTelemetrySpy();
    const ctx = createContext({ audit, telemetry });

    await runTickPipeline(
      ctx,
      [
        createPrepareCallStage({
          modelResolver: {
            resolveModelId: vi.fn(() => 'contract-model'),
          },
          modelCatalog: {
            getModelById: vi.fn(() => undefined),
          },
          toolCatalog: {
            getToolSchemas: vi.fn((): FunctionToolSchema[] => [
              {
                type: 'function' as const,
                function: {
                  name: 'mock_tool',
                  description: 'Mock tool',
                  parameters: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
            ]),
            getToolDefinition: vi.fn(() => undefined),
          },
        }),
        createBuildContextStage({ contextBuilder: createContextBuilder() }),
        createApplySystemReminderStage(),
        createExecuteLlmStage({
          promptUsageMeasurer: vi.fn(async () => {
            throw new Error('本测试未进入 Prompt usage 测量。');
          }),
          modelCatalog: { getModelById: vi.fn(() => undefined) },
          llmCaller: {
            callWithRetries: vi.fn(async () => ({
              content: 'side effect final answer',
              canonicalUsage: {
                inputTokens: 13,
                outputTokens: 5,
                totalTokens: 18,
                source: 'test-fixture' as const,
                confidence: 'actual' as const,
              },
            })),
          },
        }),
        createBuildDecisionStage(),
      ],
      [llmTelemetryMiddleware, runModelLockMiddleware]
    );

    expect(audit.emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model.select',
        runId: 'run_side_effect',
        parentRunId: 'parent_side_effect',
        decision: expect.objectContaining({
          outcome: 'recorded',
        }),
      })
    );
    expect(audit.emitMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'context.manager.before',
      })
    );
    expect(audit.emitMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'context.manager.after',
      })
    );
    expect(audit.emitMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'context.system_reminder.hit',
      })
    );

    expect(telemetry.emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'llm_call',
        modelId: 'contract-model',
        stream: false,
        durationMs: expect.any(Number),
        usage: {
          promptTokens: 13,
          completionTokens: 5,
          totalTokens: 18,
          canonicalUsage: expect.objectContaining({
            inputTokens: 13,
            outputTokens: 5,
            totalTokens: 18,
            source: 'test-fixture',
            confidence: 'actual',
          }),
        },
        canonicalUsage: expect.objectContaining({
          inputTokens: 13,
          outputTokens: 5,
          totalTokens: 18,
          source: 'test-fixture',
          confidence: 'actual',
        }),
      })
    );
    expect(ctx.decision).toEqual({
      kind: 'final_answer',
      answer: 'side effect final answer',
    });
  });
});
