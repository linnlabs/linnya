import { describe, expect, it, vi } from 'vitest';
import type {
  ImageInputAdmissionEvidence,
  LlmRequestMessage,
} from 'linnkit/ports';
import {
  LLM_IMAGE_INPUT_ERROR_CODES,
  llm,
} from 'linnkit/runtime-kernel';
import type { CanonicalInferencePort } from 'linnkit/ports';
import type { RuntimeResourceRef } from 'linnkit/contracts';
import {
  WorkspaceLlmImageResolutionError,
  type WorkspaceLlmImageReference,
  type WorkspaceLlmImageResolverPort,
} from 'src/features/workspace/assets/features/llm-image-resolution';
import type { ImageInputProcessingProfile } from '../definitions/imageInputProcessingProfile';
import { ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE } from '../registry/anthropicMessagesImageInputProfile';
import { CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE } from '../registry/chatCompletionsImageInputProfile';
import { OLLAMA_CHAT_IMAGE_INPUT_PROFILE } from '../registry/ollamaChatImageInputProfile';
import { OPENAI_RESPONSES_IMAGE_INPUT_PROFILE } from '../registry/openAiResponsesImageInputProfile';
import { createImageInputProcessingProfileRegistry } from '../orchestration/createImageInputProcessingProfileRegistry';
import { createWorkspaceLlmInputMaterializer } from '../orchestration/createWorkspaceLlmInputMaterializer';

const firstRef: RuntimeResourceRef = {
  id: 'attachment-1',
  kind: 'image',
  resourceId: 'asset-1',
  mediaType: 'image/png',
  byteLength: 120,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

const secondRef: RuntimeResourceRef = {
  id: 'attachment-2',
  kind: 'image',
  resourceId: 'asset-2',
  mediaType: 'image/webp',
  byteLength: 180,
  width: 32,
  height: 12,
  sha256: 'b'.repeat(64),
};

const messages: LlmRequestMessage[] = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'inspect', attachments: [firstRef, secondRef] },
];

function createEvidence(inputBudget = 1_000): ImageInputAdmissionEvidence {
  return {
    inputBudget,
    nonImageEstimatedTokens: 40,
    initialProfileId: 'chat-primary',
    attachments: [firstRef, secondRef].map((reference, attachmentIndex) => ({
      messageIndex: 1,
      attachmentIndex,
      id: reference.id,
      resourceId: reference.resourceId,
      placement: 'user_image' as const,
      estimatedTokens: 20,
    })),
  };
}

function createProfile(params: {
  readonly id: string;
  readonly estimatedTokens: number;
  readonly maxImages?: number;
}): ImageInputProcessingProfile {
  return {
    id: params.id,
    apiSurface: 'openai_chat_completions',
    transport: 'inline',
    detail: 'auto',
    estimatorVersion: 'test-v1',
    estimateTokens: () => params.estimatedTokens,
    limits: {
      maxImages: params.maxImages ?? 10,
      maxImageBytes: 1_000,
      maxTotalImageBytes: 2_000,
    },
  };
}

function createResolver(): WorkspaceLlmImageResolverPort {
  return {
    resolveImages: vi.fn(async references => references.map((
      reference: WorkspaceLlmImageReference,
      index: number,
    ) => ({
      id: reference.id,
      resourceId: reference.resourceId,
      mediaType: reference.mediaType,
      byteLength: reference.byteLength,
      width: reference.width,
      height: reference.height,
      bytes: new Uint8Array([index + 1]),
    }))),
  };
}

describe('workspace LLM input materializer', () => {
  it.each([
    ['OpenAI Responses', OPENAI_RESPONSES_IMAGE_INPUT_PROFILE],
    ['Chat Completions', CHAT_COMPLETIONS_IMAGE_INPUT_PROFILE],
    ['Anthropic Messages', ANTHROPIC_MESSAGES_IMAGE_INPUT_PROFILE],
    ['Ollama Chat', OLLAMA_CHAT_IMAGE_INPUT_PROFILE],
  ] as const)('%s route 接受 100 张图片并在第 101 张进入读取前明确拒绝', async (_name, profile) => {
    const createInputs = (count: number): {
      readonly messages: LlmRequestMessage[];
      readonly evidence: ImageInputAdmissionEvidence;
    } => {
      const references = Array.from({ length: count }, (_, index): RuntimeResourceRef => ({
        ...firstRef,
        id: `attachment-${index}`,
        resourceId: `asset-${index}`,
      }));
      return {
        messages: [{ role: 'user', content: '检查图片', attachments: references }],
        evidence: {
          inputBudget: 1_000_000,
          nonImageEstimatedTokens: 10,
          initialProfileId: profile.id,
          attachments: references.map((reference, attachmentIndex) => ({
            messageIndex: 0,
            attachmentIndex,
            id: reference.id,
            resourceId: reference.resourceId,
            placement: 'user_image',
            estimatedTokens: profile.estimateTokens(reference),
          })),
        },
      };
    };
    const resolver = createResolver();
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: createImageInputProcessingProfileRegistry({
        resolveRouteForModel: () => 'tested-route',
        bindings: [{ route: 'tested-route', profile }],
      }),
      workspaceResolver: resolver,
    });
    const accepted = createInputs(100);

    await expect(materializer.materialize({
      activeModelId: 'tested-model',
      messages: accepted.messages,
      admissionEvidence: accepted.evidence,
    })).resolves.toHaveLength(1);
    expect(resolver.resolveImages).toHaveBeenCalledOnce();

    const rejected = createInputs(101);
    await expect(materializer.materialize({
      activeModelId: 'tested-model',
      messages: rejected.messages,
      admissionEvidence: rejected.evidence,
    })).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      metadata: {
        limit_kind: 'image_count',
        actual_value: 101,
        limit_value: 100,
      },
    });
    expect(resolver.resolveImages).toHaveBeenCalledOnce();
  });

  it('按 durable 消息顺序解析整批图片并替换成无路径、无 hash 的 resolved input', async () => {
    const resolver = createResolver();
    const registry = createImageInputProcessingProfileRegistry({
      resolveRouteForModel: () => 'chat',
      bindings: [{ route: 'chat', profile: createProfile({ id: 'chat-primary', estimatedTokens: 20 }) }],
    });
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: registry,
      workspaceResolver: resolver,
    });

    const result = await materializer.materialize({
      activeModelId: 'primary',
      messages,
      admissionEvidence: createEvidence(),
    });

    expect(resolver.resolveImages).toHaveBeenCalledWith([firstRef, secondRef]);
    expect(result[1]).toMatchObject({
      role: 'user',
      content: 'inspect',
      attachments: [
        { id: 'attachment-1', placement: 'user_image', bytes: new Uint8Array([1]) },
        { id: 'attachment-2', placement: 'user_image', bytes: new Uint8Array([2]) },
      ],
    });
    expect(result[1]).not.toHaveProperty('attachments.0.sha256');
    expect(result[1]).not.toHaveProperty('attachments.0.localPath');
  });

  it('active route 限额在 workspace 读取前拒绝，且携带稳定安全详情', async () => {
    const resolver = createResolver();
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: createImageInputProcessingProfileRegistry({
        resolveRouteForModel: () => 'limited',
        bindings: [{ route: 'limited', profile: createProfile({
          id: 'limited-profile',
          estimatedTokens: 20,
          maxImages: 1,
        }) }],
      }),
      workspaceResolver: resolver,
    });

    await expect(materializer.materialize({
      activeModelId: 'limited-model',
      messages,
      admissionEvidence: createEvidence(),
    })).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ROUTE_LIMIT_EXCEEDED,
      metadata: {
        active_model_id: 'limited-model',
        profile_id: 'limited-profile',
        limit_kind: 'image_count',
        actual_value: 2,
        limit_value: 1,
      },
    });
    expect(resolver.resolveImages).not.toHaveBeenCalled();
  });

  it('fallback 使用新 profile 重算图片预算，不复用上一 attempt 的 resolved bytes', async () => {
    const resolver = createResolver();
    const profiles = {
      primary: createProfile({ id: 'primary-profile', estimatedTokens: 20 }),
      fallback: createProfile({ id: 'fallback-profile', estimatedTokens: 60 }),
    };
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: createImageInputProcessingProfileRegistry({
        resolveRouteForModel: modelId => modelId,
        bindings: [
          { route: 'primary', profile: profiles.primary },
          { route: 'fallback', profile: profiles.fallback },
        ],
      }),
      workspaceResolver: resolver,
    });
    const evidence = createEvidence(120);

    await expect(materializer.materialize({
      activeModelId: 'primary',
      messages,
      admissionEvidence: evidence,
    })).resolves.toHaveLength(2);
    await expect(materializer.materialize({
      activeModelId: 'fallback',
      messages,
      admissionEvidence: evidence,
    })).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
      metadata: {
        active_model_id: 'fallback',
        profile_id: 'fallback-profile',
        actual_value: 160,
        limit_value: 120,
      },
    });
    expect(resolver.resolveImages).toHaveBeenCalledOnce();
  });

  it('workspace domain 错误映射到稳定 LLM 错误并补齐消息与附件位置', async () => {
    const resolver: WorkspaceLlmImageResolverPort = {
      resolveImages: vi.fn(async () => {
        throw new WorkspaceLlmImageResolutionError(
          'attachment_integrity_failed',
          'hash_mismatch',
          secondRef.id,
          secondRef.resourceId,
        );
      }),
    };
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: createImageInputProcessingProfileRegistry({
        resolveRouteForModel: () => 'chat',
        bindings: [{ route: 'chat', profile: createProfile({ id: 'chat-primary', estimatedTokens: 20 }) }],
      }),
      workspaceResolver: resolver,
    });

    await expect(materializer.materialize({
      activeModelId: 'primary',
      messages,
      admissionEvidence: createEvidence(),
    })).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
      metadata: {
        active_model_id: 'primary',
        placement: 'user_image',
        attachment_id: secondRef.id,
        resource_id: secondRef.resourceId,
        message_index: 1,
        attachment_index: 1,
      },
    });
  });

  it('公共 LlmCaller 在 policy fallback 前按新 active profile 重新预检，失败时不产生第二次 provider attempt', async () => {
    const resolver = createResolver();
    const materializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: createImageInputProcessingProfileRegistry({
        resolveRouteForModel: modelId => modelId,
        bindings: [
          { route: 'primary', profile: createProfile({ id: 'primary-profile', estimatedTokens: 20 }) },
          { route: 'fallback', profile: createProfile({ id: 'fallback-profile', estimatedTokens: 60 }) },
        ],
      }),
      workspaceResolver: resolver,
    });
    const models: llm.ModelCatalogEntry[] = ['primary', 'fallback'].map(id => ({
      id,
      enabled: true,
      api_key: 'test-key',
      capabilities: ['chat', 'image_input'],
      adapter_input_support: { user_image: true, tool_result_image: false },
    }));
    const catalog: llm.ModelCatalogLike = {
      getModelById: id => models.find(model => model.id === id),
      getModelsByCapability: capability => models.filter(model => model.capabilities?.includes(capability)),
      getModelsByUIVisibility: () => [],
    };
    const providerFailure = new Error('provider failed');
    const inferencePort: CanonicalInferencePort = {
      async *stream() {
        throw providerFailure;
      },
    };
    const eventHandler = vi.fn();
    const caller = new llm.LlmCaller({
      inferencePort,
      modelCatalog: catalog,
      modelResolver: new llm.ModelResolver({
        modelCatalog: catalog,
        fallbackModelPreferredOrder: ['fallback'],
      }),
      llmInputMaterializer: materializer,
      maxRetries: 0,
      policyEngine: {
        decideOnError: () => ({ action: 'switch_model', reason: 'test fallback' }),
      },
    });

    await expect(caller.callWithRetries(
      'primary',
      messages,
      {},
      eventHandler,
      undefined,
      undefined,
      { imageInputAdmissionEvidence: createEvidence(120) },
    )).rejects.toMatchObject({
      errorCode: LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
      metadata: { active_model_id: 'fallback', profile_id: 'fallback-profile' },
    });
    expect(resolver.resolveImages).toHaveBeenCalledOnce();
    expect(eventHandler).toHaveBeenCalledOnce();
    expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      error_code: LLM_IMAGE_INPUT_ERROR_CODES.CONTEXT_BUDGET_EXCEEDED,
      retryable: false,
    }));
  });
});
