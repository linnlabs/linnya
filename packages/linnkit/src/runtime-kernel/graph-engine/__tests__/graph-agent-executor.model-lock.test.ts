import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInvocationRequest } from '../../../ports/agent-invocation';
import type { LlmRequestMessage } from '../../../ports';
import type { ExecutorLocalState } from '../types';
import type { RuntimeEvent } from '../../../contracts';
import type { LlmFallbackObserver } from '../../llm';
import { RunIdSchema } from '../../../contracts';

const applySystemRemindersMock = vi.fn();
const getModelByIdMock = vi.fn();

vi.mock('../../system-reminder/apply', () => ({
  applySystemReminders: applySystemRemindersMock,
}));

vi.mock('../../system-reminder/rules', () => ({
  SYSTEM_REMINDER_RULES: [],
}));

describe('GraphAgentExecutor - run 内 quota 模型锁定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applySystemRemindersMock.mockImplementation(
      ({ llmMessages }: { llmMessages: LlmRequestMessage[] }) => llmMessages
    );

    getModelByIdMock.mockImplementation((modelId: string) => {
      if (modelId === 'cloud-primary-model') {
        return {
          id: 'cloud-primary-model',
          model_name: 'cloud-primary-model',
          billing_mode: 'cloud',
          enabled: true,
        };
      }
      if (modelId === 'cloud-deepseek-reasoner') {
        return {
          id: 'cloud-deepseek-reasoner',
          model_name: 'deepseek-reasoner',
          billing_mode: 'cloud',
          enabled: true,
        };
      }
      return undefined;
    });
  });

  it('同一个 run 一旦 quota 降级，后续 tick 应持续使用锁定的 fallback 模型', async () => {
    const { GraphAgentExecutor } = await import('../executor');

    const resolveModelId = vi.fn((modelId?: string) => modelId ?? 'default-chat-model');
    const callWithRetries = vi
      .fn()
      .mockImplementationOnce(
        async (
          modelId: string,
          _messages: unknown[],
          _options: unknown,
          _eventHandler: unknown,
          _signal: unknown,
          fallbackObserver?: LlmFallbackObserver
        ) => {
          expect(modelId).toBe('cloud-primary-model');
          fallbackObserver?.onCloudQuotaFallbackApplied?.('cloud-deepseek-reasoner');
          fallbackObserver?.onLlmAttemptSucceeded?.('cloud-deepseek-reasoner');
          return '第一次已自动降级';
        }
      )
      .mockImplementationOnce(
        async (
          modelId: string,
          _messages: unknown[],
          _options: unknown,
          _eventHandler: unknown,
          _signal: unknown,
          fallbackObserver?: LlmFallbackObserver
        ) => {
          expect(modelId).toBe('cloud-deepseek-reasoner');
          fallbackObserver?.onLlmAttemptSucceeded?.('cloud-deepseek-reasoner');
          return '第二次继续使用锁定模型';
        }
      );

    const llmCaller = {
      callWithRetries,
      call: vi.fn(),
    };
    const modelResolver = {
      resolveModelId,
    };

    const toolRuntime = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };
    const contextBuilder = {
      build: vi.fn().mockResolvedValue({
        llmMessages: [
          {
            role: 'user',
            type: 'user_input',
            content: '继续执行任务',
            id: 'msg_user_1',
            timestamp: Date.now(),
          },
        ],
      }),
    };

    const executor = new GraphAgentExecutor({
      llmCaller,
      toolRuntime,
      contextBuilder,
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
      modelCatalog: {
        getModelById: getModelByIdMock,
        getModelsByCapability: vi.fn(() => []),
        getModelsByUIVisibility: vi.fn(() => []),
      },
      modelResolver,
    });

    const request: AgentInvocationRequest = {
      query: '继续执行任务',
      promptKey: 'default',
      model_id: 'cloud-primary-model',
      maxSteps: 8,
      enableTools: false,
      availableTools: [],
    };

    const history: RuntimeEvent[] = [];
    const executorLocal: ExecutorLocalState = {
      stepCount: 1,
      llmInvocationKind: 'continuation',
    };
    const toolContext = {
      conversationId: 'conv-model-lock',
      turnId: 'turn-model-lock',
      runId: RunIdSchema.parse('run-model-lock'),
    };

    const firstTick = await executor.tick({
      request,
      history,
      stream: false,
      executorLocal,
      toolContext,
    });

    expect(executorLocal.runLockedModelId).toBeUndefined();
    Object.assign(executorLocal, firstTick.executorLocalPatch);
    expect(executorLocal.runLockedModelId).toBe('cloud-deepseek-reasoner');
    expect(executorLocal.lastSuccessfulLlmModelId).toBe('cloud-deepseek-reasoner');

    await executor.tick({
      request,
      history,
      stream: false,
      executorLocal,
      toolContext,
    });

    expect(resolveModelId.mock.calls[0]?.[0]).toBe('cloud-primary-model');
    expect(resolveModelId.mock.calls[1]?.[0]).toBe('cloud-deepseek-reasoner');
    expect(callWithRetries).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('模型选择与 fallback 都应发 AuditEnvelope', async () => {
    const { GraphAgentExecutor } = await import('../executor');

    const auditPort = { emit: vi.fn() };
    const callWithRetries = vi
      .fn()
      .mockImplementation(
        async (
          _modelId: string,
          _messages: unknown[],
          _options: unknown,
          _eventHandler: unknown,
          _signal: unknown,
          fallbackObserver?: LlmFallbackObserver
        ) => {
          fallbackObserver?.onModelFallbackRejected?.({
            fromModelId: 'cloud-primary-model',
            candidateModelId: 'cloud-text-only',
            reason: 'image_input_unsupported',
            policy: 'cloud-quota',
            requiredPlacements: ['user_image'],
          });
          fallbackObserver?.onCloudQuotaFallbackApplied?.('cloud-deepseek-reasoner');
          fallbackObserver?.onModelFallbackApplied?.({
            fromModelId: 'cloud-primary-model',
            toModelId: 'cloud-deepseek-reasoner',
            reason: 'quota exhausted',
            policy: 'cloud-quota',
          });
          return 'fallback ok';
        }
      );

    const executor = new GraphAgentExecutor({
      llmCaller: { callWithRetries } as never,
      toolRuntime: {
        getToolSchemas: vi.fn(() => []),
        getToolDefinition: vi.fn(() => undefined),
      },
      contextBuilder: {
        build: vi.fn().mockResolvedValue({
          llmMessages: [{ role: 'user', content: 'hi' }],
        }),
      },
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
      modelCatalog: {
        getModelById: getModelByIdMock,
        getModelsByCapability: vi.fn(() => []),
        getModelsByUIVisibility: vi.fn(() => []),
      },
      modelResolver: {
        resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-chat-model'),
      },
      auditPort,
    });

    await executor.tick({
      request: {
        query: '继续执行任务',
        promptKey: 'default',
        model_id: 'cloud-primary-model',
        maxSteps: 8,
        enableTools: false,
        availableTools: [],
      },
      history: [],
      stream: false,
      executorLocal: { stepCount: 1, llmInvocationKind: 'continuation' },
      toolContext: {
        conversationId: 'conv-audit',
        turnId: 'turn-audit',
        runId: RunIdSchema.parse('run-audit'),
      },
    });

    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model.select',
        runId: 'run-audit',
        scope: expect.objectContaining({
          conversationId: 'conv-audit',
          turnId: 'turn-audit',
          runId: 'run-audit',
          modelId: 'cloud-primary-model',
        }),
      })
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model.fallback',
        decision: expect.objectContaining({
          outcome: 'denied',
          reason: 'image_input_unsupported',
          metadata: expect.objectContaining({
            candidateModelId: 'cloud-text-only',
            requiredPlacements: ['user_image'],
          }),
        }),
      })
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'model.fallback',
        decision: expect.objectContaining({
          outcome: 'fallback',
          policy: 'cloud-quota',
        }),
        scope: expect.objectContaining({
          modelId: 'cloud-deepseek-reasoner',
        }),
      })
    );
  });
});
