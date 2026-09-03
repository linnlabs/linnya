import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalInferencePort } from '../../../ports';
import type { ModelCatalogLike } from '../modelCatalog';
import type { AiMessage } from '../../../contracts';

const chatCompletionMock = vi.fn();
const getModelByIdMock = vi.fn();
const decideOnErrorMock = vi.fn();

vi.mock('../policies/defaultPolicyEngine', () => ({
  defaultPolicyEngine: {
    decideOnError: decideOnErrorMock,
  },
}));

describe('LlmCaller fallback boundary', () => {
  let inferencePort: CanonicalInferencePort;
  let modelCatalog: ModelCatalogLike;
  const messages: AiMessage[] = [
    {
      role: 'user',
      type: 'user_input',
      content: '继续执行',
      id: 'msg_fallback_boundary',
      timestamp: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.resetModules();
    chatCompletionMock.mockReset();
    getModelByIdMock.mockReset();
    decideOnErrorMock.mockReset();
    getModelByIdMock.mockReturnValue({
      id: 'primary-model',
      billing_mode: 'byok',
      enable_client_retry: true,
      api_key: 'primary-key',
      model_name: 'primary-model',
      capabilities: ['chat'],
    });
    modelCatalog = {
      getModelById: getModelByIdMock,
      getModelsByCapability: vi.fn(() => []),
      getModelsByUIVisibility: vi.fn(() => []),
    };
    inferencePort = {
      async *stream(request) {
        yield {
          type: 'start',
          model_id: request.model_id,
          attempt_id: request.invocation.attempt_id,
        };
        const content = await chatCompletionMock(request.model_id, request.messages);
        if (typeof content === 'string' && content) {
          yield { type: 'answer_delta', text: content };
        }
        yield { type: 'finish', reason: 'stop' };
      },
    };
  });

  it('Policy Model Switch 只通过 ModelResolver 选备用模型，不触发 quota fallback 回调', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn(() => 'policy-fallback-model'),
    };

    chatCompletionMock
      .mockRejectedValueOnce(new Error('policy switch wanted'))
      .mockResolvedValueOnce('policy fallback success');
    decideOnErrorMock.mockReturnValue({
      action: 'switch_model',
      reason: 'policy boundary',
    });

    const onCloudQuotaFallbackApplied = vi.fn();
    const caller = new LlmCaller({ modelResolver, modelCatalog, inferencePort });

    const result = await caller.callWithRetries(
      'primary-model',
      messages,
      {},
      undefined,
      undefined,
      { onCloudQuotaFallbackApplied },
    );

    expect(result).toEqual({ content: 'policy fallback success' });
    expect(chatCompletionMock.mock.calls[0]?.[0]).toBe('primary-model');
    expect(chatCompletionMock.mock.calls[1]?.[0]).toBe('policy-fallback-model');
    expect(modelResolver.pickFallbackChatModel).toHaveBeenCalledTimes(1);
    expect(onCloudQuotaFallbackApplied).not.toHaveBeenCalled();
  });

  it('Cloud Quota Fallback 只走 run-scoped fallback model id，不借用 ModelResolver', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn(() => 'policy-fallback-model'),
    };

    chatCompletionMock
      .mockRejectedValueOnce(new Error('今日使用次数已达上限（3次），明天再来吧'))
      .mockResolvedValueOnce('quota fallback success');
    decideOnErrorMock.mockReturnValue({
      action: 'none',
      reason: 'no policy switch',
    });
    getModelByIdMock.mockImplementation((id: string) => ({
      id,
      billing_mode: 'cloud',
      enable_client_retry: false,
      api_key: `${id}-key`,
      model_name: id,
      capabilities: ['chat'],
    }));

    const onCloudQuotaFallbackApplied = vi.fn();
    const caller = new LlmCaller({ modelResolver, modelCatalog, inferencePort });

    const result = await caller.callWithRetries(
      'cloud-primary-model',
      messages,
      { cloud_quota_fallback_model_id: 'cloud-deepseek-reasoner' },
      undefined,
      undefined,
      { onCloudQuotaFallbackApplied },
    );

    expect(result).toEqual({ content: 'quota fallback success' });
    expect(chatCompletionMock.mock.calls[0]?.[0]).toBe('cloud-primary-model');
    expect(chatCompletionMock.mock.calls[1]?.[0]).toBe('cloud-deepseek-reasoner');
    expect(modelResolver.pickFallbackChatModel).not.toHaveBeenCalled();
    expect(onCloudQuotaFallbackApplied).toHaveBeenCalledTimes(1);
    expect(onCloudQuotaFallbackApplied).toHaveBeenCalledWith('cloud-deepseek-reasoner');
  });

  it('固定模型调用不应被 Policy Model Switch 自动切到备用模型', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn(() => 'policy-fallback-model'),
    };

    chatCompletionMock.mockRejectedValueOnce(new Error('policy switch wanted'));
    decideOnErrorMock.mockReturnValue({
      action: 'switch_model',
      reason: 'policy boundary',
    });

    const caller = new LlmCaller({ modelResolver, modelCatalog, inferencePort });

    await expect(
      caller.callWithRetries(
        'primary-model',
        messages,
        { allow_model_fallback: false },
      ),
    ).rejects.toThrow('policy switch wanted');

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionMock.mock.calls[0]?.[0]).toBe('primary-model');
    expect(modelResolver.pickFallbackChatModel).not.toHaveBeenCalled();
  });

  it('固定模型调用不应被 Cloud Quota Fallback 自动切到降级模型', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn(() => 'policy-fallback-model'),
    };

    chatCompletionMock.mockRejectedValueOnce(new Error('今日使用次数已达上限（3次），明天再来吧'));
    decideOnErrorMock.mockReturnValue({
      action: 'none',
      reason: 'no policy switch',
    });
    getModelByIdMock.mockImplementation((id: string) => ({
      id,
      billing_mode: 'cloud',
      enable_client_retry: false,
      api_key: `${id}-key`,
      model_name: id,
      capabilities: ['chat'],
    }));

    const onCloudQuotaFallbackApplied = vi.fn();
    const caller = new LlmCaller({ modelResolver, modelCatalog, inferencePort });

    await expect(
      caller.callWithRetries(
        'cloud-primary-model',
        messages,
        {
          allow_model_fallback: false,
          cloud_quota_fallback_model_id: 'cloud-deepseek-reasoner',
        },
        undefined,
        undefined,
        { onCloudQuotaFallbackApplied },
      ),
    ).rejects.toThrow('今日使用次数已达上限');

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(chatCompletionMock.mock.calls[0]?.[0]).toBe('cloud-primary-model');
    expect(onCloudQuotaFallbackApplied).not.toHaveBeenCalled();
    expect(modelResolver.pickFallbackChatModel).not.toHaveBeenCalled();
  });

  it('Policy Model Switch 不能绕开 maxTotalAttempts 继续多级切模型', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn()
        .mockReturnValueOnce('policy-fallback-a')
        .mockReturnValueOnce('policy-fallback-b'),
    };

    chatCompletionMock
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('fallback failed'));
    decideOnErrorMock.mockReturnValue({
      action: 'switch_model',
      reason: 'policy boundary',
    });

    const caller = new LlmCaller({
      modelResolver,
      modelCatalog,
      inferencePort,
      maxRetries: 0,
      maxTotalAttempts: 2,
    });

    await expect(caller.callWithRetries('primary-model', messages)).rejects.toThrow('fallback failed');

    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(chatCompletionMock.mock.calls[0]?.[0]).toBe('primary-model');
    expect(chatCompletionMock.mock.calls[1]?.[0]).toBe('policy-fallback-a');
    expect(modelResolver.pickFallbackChatModel).toHaveBeenCalledTimes(1);
  });

  it('Policy Model Switch 跳过容量不足候选，并记录明确拒绝原因', async () => {
    const { LlmCaller } = await import('../caller');
    const modelResolver = {
      resolveModelId: vi.fn((modelId?: string) => modelId ?? 'default-model'),
      pickFallbackChatModel: vi.fn()
        .mockReturnValueOnce('small-window-model')
        .mockReturnValueOnce('large-window-model'),
    };
    chatCompletionMock
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce('large fallback success');
    decideOnErrorMock.mockReturnValue({
      action: 'switch_model',
      reason: 'policy boundary',
    });
    const onModelFallbackRejected = vi.fn();
    const caller = new LlmCaller({ modelResolver, modelCatalog, inferencePort });

    await expect(caller.callWithRetries(
      'primary-model',
      messages,
      {},
      undefined,
      undefined,
      { onModelFallbackRejected },
      {
        evaluateFallbackPromptCapacity: candidateModelId => candidateModelId === 'small-window-model'
          ? { admitted: false, reason: 'fallback_context_window_exceeded' }
          : { admitted: true },
      },
    )).resolves.toEqual({ content: 'large fallback success' });

    expect(chatCompletionMock.mock.calls.map(call => call[0])).toEqual([
      'primary-model',
      'large-window-model',
    ]);
    expect(modelResolver.pickFallbackChatModel).toHaveBeenCalledTimes(2);
    expect(onModelFallbackRejected).toHaveBeenCalledWith(expect.objectContaining({
      candidateModelId: 'small-window-model',
      reason: 'fallback_context_window_exceeded',
    }));
  });
});
