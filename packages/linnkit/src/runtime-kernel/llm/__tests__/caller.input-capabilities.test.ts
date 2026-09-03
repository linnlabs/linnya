import { describe, expect, it, vi } from 'vitest';
import type {
  CanonicalInferencePort,
  ImageInputAdmissionEvidence,
  LlmInputMaterializerPort,
} from '../../../ports';
import type { RuntimeResourceRef } from '../../../contracts';
import type { LlmCallOptions, LlmRequestMessage } from '../caller.types';
import { LlmCaller } from '../caller';
import type { ModelCatalogEntry, ModelCatalogLike } from '../modelCatalog';
import { ModelResolver } from '../modelResolver';
import { buildLlmCallerDeps, type LlmCallerOptions } from '../request-builder';
import { callWithRetryFallback } from '../retry-fallback';
import type { LlmFallbackObserver } from '../definitions/llmFallbackObserver';
import {
  LLM_MODEL_ELIGIBILITY_ERROR_CODE,
  MODEL_INPUT_ERROR_CODES,
} from '../input-capabilities';

const imageRef = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

function model(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: 'primary',
    enabled: true,
    api_key: 'test-key',
    capabilities: ['chat', 'image_input'],
    adapter_input_support: { user_image: true, tool_result_image: true },
    ...overrides,
  };
}

function createCatalog(models: readonly ModelCatalogEntry[]): ModelCatalogLike {
  return {
    getModelById: vi.fn((id: string) => models.find((entry) => entry.id === id)),
    getModelsByCapability: vi.fn((capability: string) =>
      models.filter((entry) => entry.capabilities?.includes(capability))),
    getModelsByUIVisibility: vi.fn(() => []),
  };
}

type Completion = (
  modelId: string,
  messages: Parameters<CanonicalInferencePort['stream']>[0]['messages']
) => Promise<string>;

function createInferencePort(chatCompletion: Completion): CanonicalInferencePort {
  return {
    async *stream(request) {
      const content = await chatCompletion(request.model_id, request.messages);
      yield { type: 'start', model_id: request.model_id, attempt_id: request.invocation.attempt_id };
      if (content) yield { type: 'answer_delta', text: content };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

const userImageMessages: LlmRequestMessage[] = [
  { role: 'user', content: '', attachments: [imageRef] },
];

const toolImageMessages: LlmRequestMessage[] = [
  { role: 'tool', tool_call_id: 'call-1', content: '', attachments: [imageRef] },
];

const admissionEvidence: ImageInputAdmissionEvidence = {
  inputBudget: 4_096,
  nonImageEstimatedTokens: 8,
  initialProfileId: 'test-profile',
  attachments: [{
    messageIndex: 0,
    attachmentIndex: 0,
    id: imageRef.id,
    resourceId: imageRef.resourceId,
    placement: 'user_image',
    estimatedTokens: 32,
  }],
};

function createTestMaterializer(): LlmInputMaterializerPort {
  return {
    materialize: vi.fn(async attempt => attempt.messages.map((message: LlmRequestMessage) => {
      if (!('attachments' in message) || !message.attachments?.length) return message;
      return {
        ...message,
        attachments: message.attachments.map((attachment: RuntimeResourceRef) => ({
          id: attachment.id,
          resourceId: attachment.resourceId,
          mediaType: attachment.mediaType,
          byteLength: attachment.byteLength,
          width: attachment.width,
          height: attachment.height,
          placement: message.role === 'tool' ? 'tool_result_image' as const : 'user_image' as const,
          bytes: new Uint8Array([1, 2, 3]),
        })),
      };
    })),
  };
}

function callWithUserImageRequirement(
  callerOptions: LlmCallerOptions,
  callOptions: LlmCallOptions = {},
  fallbackObserver?: LlmFallbackObserver,
) {
  const llmInputMaterializer = callerOptions.llmInputMaterializer ?? createTestMaterializer();
  return callWithRetryFallback({
    deps: {
      ...buildLlmCallerDeps({ ...callerOptions, llmInputMaterializer }),
      modelCatalog: callerOptions.modelCatalog,
    },
    modelId: 'primary',
    messages: userImageMessages,
    requirement: {
      requires_image_input: true,
      placements: ['user_image'],
    },
    options: callOptions,
    fallbackObserver,
    invocationContext: { imageInputAdmissionEvidence: admissionEvidence },
  });
}

describe('LlmCaller 图片输入能力门禁', () => {
  it('纯文本消息携带工具 requirement 时只校验兼容性，不触发图片物化', async () => {
    const chatCompletion = vi.fn().mockResolvedValue('tool schema accepted');
    const materializer = createTestMaterializer();
    const caller = new LlmCaller({
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: createCatalog([model()]),
      llmInputMaterializer: materializer,
    });

    await expect(caller.callWithRetries(
      'primary',
      [{ role: 'user', content: 'use the image tool' }],
      {},
      undefined,
      undefined,
      undefined,
      {
        additionalModelInputRequirement: {
          requires_image_input: true,
          placements: ['tool_result_image'],
        },
      },
    )).resolves.toEqual({ content: 'tool schema accepted' });

    expect(materializer.materialize).not.toHaveBeenCalled();
    expect(chatCompletion).toHaveBeenCalledOnce();
  });

  it('能力通过后才物化，并只把 resolved input 交给 canonical port', async () => {
    const chatCompletion = vi.fn().mockResolvedValue('image success');
    const materializer = createTestMaterializer();
    const caller = new LlmCaller({
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: createCatalog([model()]),
      llmInputMaterializer: materializer,
    });

    await expect(caller.call(
      'primary',
      userImageMessages,
      {},
      undefined,
      { imageInputAdmissionEvidence: admissionEvidence },
    )).resolves.toEqual({ content: 'image success' });

    expect(materializer.materialize).toHaveBeenCalledOnce();
    const providerMessages = chatCompletion.mock.calls[0]?.[1];
    expect(providerMessages?.[0]).toMatchObject({
      role: 'user',
      content: [{
        type: 'image',
        media_type: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
      }],
    });
  });

  it('含图但缺 admission evidence 时不物化、不调用 provider，并只发一个稳定错误事件', async () => {
    const chatCompletion = vi.fn();
    const materializer = createTestMaterializer();
    const eventHandler = vi.fn();
    const caller = new LlmCaller({
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: createCatalog([model()]),
      llmInputMaterializer: materializer,
    });

    await expect(caller.callWithRetries(
      'primary',
      userImageMessages,
      {},
      eventHandler,
    )).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
    });
    expect(materializer.materialize).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(eventHandler).toHaveBeenCalledOnce();
    expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      error_code: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      retryable: false,
    }));
  });

  it('call 在模型不支持图片时以稳定错误阻断 Provider attempt', async () => {
    const chatCompletion = vi.fn();
    const catalog = createCatalog([
      model({ capabilities: ['chat'] }),
      model({ id: 'compatible' }),
    ]);
    const caller = new LlmCaller({ inferencePort: createInferencePort(chatCompletion), modelCatalog: catalog });

    await expect(caller.call('primary', userImageMessages)).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.MODEL_UNSUPPORTED,
      recoverable: false,
      metadata: {
        active_model_id: 'primary',
        required_placements: ['user_image'],
        compatible_model_ids: ['compatible'],
      },
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('callStream 区分 tool-result placement，不用 user 支持冒充', async () => {
    const chatCompletionStream = vi.fn();
    const inferencePort: CanonicalInferencePort = {
      stream: chatCompletionStream,
    };
    const catalog = createCatalog([
      model({ adapter_input_support: { user_image: true, tool_result_image: false } }),
    ]);
    const caller = new LlmCaller({ inferencePort, modelCatalog: catalog });

    await expect(caller.callStream(
      'primary',
      toolImageMessages,
      {},
      vi.fn(),
    )).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED,
      metadata: { required_placements: ['tool_result_image'] },
    });
    expect(chatCompletionStream).not.toHaveBeenCalled();
  });

  it('纯文本显式模型仍校验 exists、enabled 与 chat', async () => {
    const chatCompletion = vi.fn();
    const catalog = createCatalog([
      model({ id: 'disabled', enabled: false, capabilities: ['chat'] }),
      model({ id: 'embedding', capabilities: ['embedding'] }),
    ]);
    const caller = new LlmCaller({ inferencePort: createInferencePort(chatCompletion), modelCatalog: catalog });
    const textMessages: LlmRequestMessage[] = [{ role: 'user', content: 'hello' }];

    for (const modelId of ['missing', 'disabled', 'embedding']) {
      await expect(caller.call(modelId, textMessages)).rejects.toMatchObject({
        errorCode: LLM_MODEL_ELIGIBILITY_ERROR_CODE,
        recoverable: false,
      });
    }
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('同模型 retry 会重新读取能力，拒绝时不产生第二次真实 attempt', async () => {
    let activeModel = model();
    const catalog: ModelCatalogLike = {
      getModelById: vi.fn(() => activeModel),
      getModelsByCapability: vi.fn(() => [activeModel]),
      getModelsByUIVisibility: vi.fn(() => []),
    };
    const chatCompletion = vi.fn(async () => {
      activeModel = model({
        adapter_input_support: { user_image: false, tool_result_image: false },
      });
      throw new Error('Network timeout');
    });
    const callerOptions: LlmCallerOptions = {
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: catalog,
      maxRetries: 1,
      retryDelayMs: 0,
    };

    await expect(callWithUserImageRequirement(callerOptions)).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED,
    });
    expect(chatCompletion).toHaveBeenCalledOnce();
  });

  it('policy fallback 跳过不兼容候选并保持原 preferred order', async () => {
    const models = [
      model(),
      model({
        id: 'preferred-incompatible',
        adapter_input_support: { user_image: false, tool_result_image: false },
      }),
      model({ id: 'compatible-fallback' }),
    ];
    const catalog = createCatalog(models);
    const resolver = new ModelResolver({
      modelCatalog: catalog,
      fallbackModelPreferredOrder: ['preferred-incompatible', 'compatible-fallback'],
    });
    const chatCompletion = vi.fn(async (modelId: string) => {
      if (modelId === 'primary') throw new Error('provider failed');
      return 'fallback success';
    });
    const materializer = createTestMaterializer();
    const onLlmAttemptSucceeded = vi.fn();
    const callerOptions: LlmCallerOptions = {
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: catalog,
      modelResolver: resolver,
      maxRetries: 0,
      policyEngine: {
        decideOnError: () => ({ action: 'switch_model', reason: 'test switch' }),
      },
      llmInputMaterializer: materializer,
    };

    await expect(callWithUserImageRequirement(
      callerOptions,
      {},
      { onLlmAttemptSucceeded },
    )).resolves.toEqual({ content: 'fallback success' });
    expect(chatCompletion.mock.calls.map((call) => call[0])).toEqual([
      'primary',
      'compatible-fallback',
    ]);
    expect(vi.mocked(materializer.materialize).mock.calls.map((call) => call[0].activeModelId)).toEqual([
      'primary',
      'compatible-fallback',
    ]);
    expect(onLlmAttemptSucceeded).toHaveBeenCalledOnce();
    expect(onLlmAttemptSucceeded).toHaveBeenCalledWith('compatible-fallback');
  });

  it('quota fallback 不兼容时保留原额度错误且不重放图片消息', async () => {
    const catalog = createCatalog([
      model({ id: 'cloud-primary', billing_mode: 'cloud', enable_client_retry: false }),
      model({
        id: 'cloud-fallback',
        billing_mode: 'cloud',
        enable_client_retry: false,
        capabilities: ['chat'],
      }),
    ]);
    const quotaError = new Error('今日使用次数已达上限（3次），明天再来吧');
    const chatCompletion = vi.fn().mockRejectedValue(quotaError);
    const onQuotaFallback = vi.fn();
    const onModelFallbackRejected = vi.fn();
    const callerOptions: LlmCallerOptions = {
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: catalog,
      maxRetries: 0,
    };

    await expect(callWithRetryFallback({
      invocationContext: { imageInputAdmissionEvidence: admissionEvidence },
      deps: {
        ...buildLlmCallerDeps({
          ...callerOptions,
          llmInputMaterializer: createTestMaterializer(),
        }),
        modelCatalog: catalog,
      },
      modelId: 'cloud-primary',
      messages: userImageMessages,
      requirement: { requires_image_input: true, placements: ['user_image'] },
      options: { cloud_quota_fallback_model_id: 'cloud-fallback' },
      fallbackObserver: {
        onCloudQuotaFallbackApplied: onQuotaFallback,
        onModelFallbackRejected,
      },
    })).rejects.toBe(quotaError);
    expect(chatCompletion).toHaveBeenCalledOnce();
    expect(onQuotaFallback).not.toHaveBeenCalled();
    expect(onModelFallbackRejected).toHaveBeenCalledWith({
      fromModelId: 'cloud-primary',
      candidateModelId: 'cloud-fallback',
      policy: 'cloud-quota',
      reason: 'image_input_unsupported',
      requiredPlacements: ['user_image'],
    });
  });

  it('policy fallback 没有兼容候选时保留原错误并给出安全拒绝证据', async () => {
    const providerError = new Error('provider failed');
    const models = [
      model(),
      model({
        id: 'text-only-fallback',
        capabilities: ['chat'],
        adapter_input_support: { user_image: false, tool_result_image: false },
      }),
    ];
    const catalog = createCatalog(models);
    const resolver = new ModelResolver({ modelCatalog: catalog });
    const chatCompletion = vi.fn().mockRejectedValue(providerError);
    const onModelFallbackRejected = vi.fn();
    const callerOptions: LlmCallerOptions = {
      inferencePort: createInferencePort(chatCompletion),
      modelCatalog: catalog,
      modelResolver: resolver,
      maxRetries: 0,
      policyEngine: {
        decideOnError: () => ({ action: 'switch_model', reason: 'test switch' }),
      },
    };

    await expect(callWithUserImageRequirement(
      callerOptions,
      {},
      { onModelFallbackRejected },
    )).rejects.toBe(providerError);
    expect(chatCompletion).toHaveBeenCalledOnce();
    expect(onModelFallbackRejected).toHaveBeenCalledWith({
      fromModelId: 'primary',
      policy: 'policy-switch',
      reason: 'no_eligible_fallback_candidate',
      requiredPlacements: ['user_image'],
    });
  });

  it('allow_model_fallback=false 不绕过当前模型能力校验', async () => {
    const chatCompletion = vi.fn();
    const catalog = createCatalog([
      model({ adapter_input_support: { user_image: false, tool_result_image: false } }),
    ]);
    const caller = new LlmCaller({ inferencePort: createInferencePort(chatCompletion), modelCatalog: catalog });

    await expect(caller.callWithRetries(
      'primary',
      userImageMessages,
      { allow_model_fallback: false },
    )).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED,
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('wait-user 恢复与 child run 都从各自 final messages 重新派生要求', async () => {
    const chatCompletion = vi.fn().mockResolvedValue('text success');
    const catalog = createCatalog([
      model({ capabilities: ['chat'] }),
    ]);
    const caller = new LlmCaller({ inferencePort: createInferencePort(chatCompletion), modelCatalog: catalog });
    const textMessages: LlmRequestMessage[] = [{ role: 'user', content: 'plain text' }];

    await expect(caller.call('primary', textMessages)).resolves.toEqual({ content: 'text success' });
    await expect(caller.call('primary', userImageMessages)).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.MODEL_UNSUPPORTED,
      metadata: { required_placements: ['user_image'] },
    });

    // child run 不继承父 run 的图片要求，但自身 final context 含图时仍独立校验。
    await expect(caller.call('primary', textMessages)).resolves.toEqual({ content: 'text success' });
    await expect(caller.call('primary', toolImageMessages)).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.MODEL_UNSUPPORTED,
      metadata: { required_placements: ['tool_result_image'] },
    });

    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(chatCompletion.mock.calls.every((call) => (
      Array.isArray(call[1])
      && call[1].length === 1
      && call[1][0]?.role === 'user'
      && Array.isArray(call[1][0]?.content)
      && call[1][0]?.content[0]?.type === 'text'
      && call[1][0]?.content[0]?.text === 'plain text'
    ))).toBe(true);
  });
});
