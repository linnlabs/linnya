import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInvocationRequest } from '../../../../ports/agent-invocation';
import type { TokenizerPort } from '../../../../ports';
import { noopAudit } from '../../../audit/noopAudit';
import type { TelemetryPort } from '../../../telemetry/telemetryPort';
import type { TickPipelineContext, TickStage } from '../types';
import { RunIdSchema } from '../../../../contracts';

const normalizedUsageFromCanonicalMock = vi.fn(canonicalUsage => ({
  promptTokens: canonicalUsage.inputTokens,
  completionTokens: canonicalUsage.outputTokens,
  totalTokens:
    canonicalUsage.totalTokens ?? canonicalUsage.inputTokens + canonicalUsage.outputTokens,
  canonicalUsage,
}));

vi.mock('../../../../shared/llmTelemetryContext', () => ({
  normalizedUsageFromCanonical: normalizedUsageFromCanonicalMock,
}));

function createRequest(): AgentInvocationRequest {
  return {
    query: '继续执行',
    promptKey: 'default',
    model_id: 'mock-model',
    maxSteps: 8,
    enableTools: false,
    availableTools: [],
  };
}

type TelemetrySpy = TelemetryPort & {
  emitMock: ReturnType<typeof vi.fn>;
};

type TokenizerMock = TokenizerPort & {
  estimateTextMock: ReturnType<typeof vi.fn>;
  estimateMessageMock: ReturnType<typeof vi.fn>;
};

function createTelemetrySpy(): TelemetrySpy {
  const emitMock = vi.fn();
  return {
    emit: emitMock,
    emitMock,
  };
}

function createTokenizerMock(): TokenizerMock {
  const estimateTextMock = vi.fn(() => 5);
  const estimateMessageMock = vi.fn(() => 20);
  return {
    estimateTextMock,
    estimateMessageMock,
    estimateText: estimateTextMock,
    estimateMessage: estimateMessageMock,
  };
}

function createContext(
  telemetry: TelemetrySpy = createTelemetrySpy()
): TickPipelineContext & { telemetry: TelemetrySpy; tokenizer: TokenizerMock } {
  const request = createRequest();
  return {
    input: {
      request,
      history: [],
      stream: true,
      toolContext: {
        runId: RunIdSchema.parse('run_telemetry'),
        parentRunId: RunIdSchema.parse('parent_run_telemetry'),
      },
    },
    request,
    history: [],
    forceFinalAnswer: false,
    modelId: 'mock-model',
    toolSchemas: [],
    toolCallStreamingPolicies: {},
    toolDefinitionTokens: 0,
    llmOptions: {},
    llmMessages: [{ role: 'user', content: 'hello' }],
    conversationId: 'conv_telemetry',
    turnId: 'turn_telemetry',
    llmCallStartedAt: 100,
    llmCallDurationMs: 35,
    telemetry,
    audit: noopAudit,
    tokenizer: createTokenizerMock(),
  };
}

function expectSingleLlmCall(ctx: TickPipelineContext & { telemetry: TelemetrySpy }): void {
  expect(ctx.telemetry.emitMock).toHaveBeenCalledTimes(1);
}

function createStage(id: TickStage['id']): TickStage {
  return {
    id,
    reads: [],
    writes: [],
    async run() {},
  };
}

describe('llmTelemetryMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('优先使用 Host 回传的 canonical usage 记录 telemetry', async () => {
    const { llmTelemetryMiddleware } = await import('./llmTelemetryMiddleware');
    const ctx = createContext();
    const stage = createStage('execute_llm');
    const canonicalUsage = {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      source: 'host-supplied' as const,
      confidence: 'actual' as const,
    };

    await llmTelemetryMiddleware(ctx, stage, async () => {
      ctx.llmResp = {
        content: 'final answer',
        canonicalUsage,
      };
    });

    expect(normalizedUsageFromCanonicalMock).toHaveBeenCalledWith(canonicalUsage);
    expectSingleLlmCall(ctx);
    expect(ctx.telemetry.emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'llm_call',
        modelId: 'mock-model',
        stream: true,
        durationMs: 35,
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          canonicalUsage,
        },
        canonicalUsage,
      })
    );
    expect(ctx.tokenizer.estimateMessage).not.toHaveBeenCalled();
    expect(ctx.tokenizer.estimateText).not.toHaveBeenCalled();
  });

  it('provider usage 缺失时回退到 TokenizerPort 本地估算', async () => {
    const { llmTelemetryMiddleware } = await import('./llmTelemetryMiddleware');
    const ctx = createContext();
    const stage = createStage('execute_llm');

    await llmTelemetryMiddleware(ctx, stage, async () => {
      ctx.llmResp = {
        content: 'partial answer',
      };
    });

    expectSingleLlmCall(ctx);
    expect(ctx.telemetry.emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'llm_call',
        modelId: 'mock-model',
        stream: true,
        durationMs: 35,
        usage: {
          promptTokens: 20,
          completionTokens: 5,
          totalTokens: 25,
          canonicalUsage: {
            inputTokens: 20,
            outputTokens: 5,
            totalTokens: 25,
            source: 'local-estimate',
            confidence: 'estimate',
          },
        },
        canonicalUsage: {
          inputTokens: 20,
          outputTokens: 5,
          totalTokens: 25,
          source: 'local-estimate',
          confidence: 'estimate',
        },
      })
    );
    expect(ctx.tokenizer.estimateMessage).toHaveBeenCalledWith(
      { role: 'user', content: 'hello' },
      'mock-model'
    );
    expect(ctx.tokenizer.estimateText).toHaveBeenCalledWith('partial answer', 'mock-model');
  });

  describe('B2-engine Batch 1: TelemetryPort emit', () => {
    it('emits llm_call event to ctx.telemetry with usage + scope', async () => {
      const { llmTelemetryMiddleware } = await import('./llmTelemetryMiddleware');
      const telemetry = createTelemetrySpy();
      const ctx = createContext(telemetry);
      const stage = createStage('execute_llm');

      const canonicalUsage = {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        source: 'host-supplied' as const,
        confidence: 'actual' as const,
      };

      await llmTelemetryMiddleware(ctx, stage, async () => {
        ctx.llmResp = {
          content: 'final answer',
          canonicalUsage,
        };
      });

      expect(telemetry.emitMock).toHaveBeenCalledTimes(1);
      expect(telemetry.emitMock).toHaveBeenCalledWith({
        kind: 'llm_call',
        modelId: 'mock-model',
        stream: true,
        durationMs: 35,
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          canonicalUsage,
        },
        canonicalUsage,
        scope: {
          conversationId: 'conv_telemetry',
          runId: 'run_telemetry',
          parentRunId: 'parent_run_telemetry',
          turnId: 'turn_telemetry',
        },
      });
    });

    it('does NOT emit when stage.id !== execute_llm', async () => {
      const { llmTelemetryMiddleware } = await import('./llmTelemetryMiddleware');
      const telemetry = createTelemetrySpy();
      const ctx = createContext(telemetry);
      const stage = createStage('build_context');

      await llmTelemetryMiddleware(ctx, stage, async () => {});

      expect(telemetry.emitMock).not.toHaveBeenCalled();
    });

    it('omits conversationId from scope when ctx.conversationId is empty string', async () => {
      const { llmTelemetryMiddleware } = await import('./llmTelemetryMiddleware');
      const telemetry = createTelemetrySpy();
      const ctx = createContext(telemetry);
      ctx.conversationId = '';
      const stage = createStage('execute_llm');

      const tokenizer = createTokenizerMock();
      tokenizer.estimateMessageMock.mockReturnValue(0);
      tokenizer.estimateTextMock.mockReturnValue(0);
      ctx.tokenizer = tokenizer;

      await llmTelemetryMiddleware(ctx, stage, async () => {
        ctx.llmResp = { content: '' };
      });

      expect(telemetry.emitMock).toHaveBeenCalledTimes(1);
      const emittedEvent = telemetry.emitMock.mock.calls[0]![0];
      expect(emittedEvent.scope).toEqual({
        conversationId: undefined,
        runId: 'run_telemetry',
        parentRunId: 'parent_run_telemetry',
        turnId: 'turn_telemetry',
      });
    });
  });
});
