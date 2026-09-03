import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runtimeEventToSSEEvent,
  validateRuntimeEvent,
  validateSSEEvent,
  type RuntimeResourceRef,
} from '../../../contracts';
import type { CanonicalInferencePort } from '../../../ports';
import { ErrorClassifier } from '../../../shared/errorClassifier';
import { agentEventToRuntime } from '../../events/agent-to-runtime';
import type { ErrorEvent as AgentErrorEvent } from '../../events/agentEvents';
import { LlmCaller } from '../caller';
import {
  MODEL_INPUT_ERROR_CODES,
} from '../input-capabilities';
import {
  LLM_IMAGE_INPUT_ERROR_CODES,
  LlmImageInputError,
} from '../input-materialization';
import { createLlmAgentErrorEvent } from '../functions/createLlmAgentErrorEvent';
import type { ModelCatalogLike } from '../modelCatalog';

const imageRef: RuntimeResourceRef = {
  id: 'attachment-1',
  kind: 'image',
  resourceId: 'asset-1',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

function createCompatibleCatalog(): ModelCatalogLike {
  const entry = {
    id: 'vision-model',
    enabled: true,
    capabilities: ['chat', 'image_input'],
    adapter_input_support: { user_image: true, tool_result_image: true },
  };
  return {
    getModelById: id => id === entry.id ? entry : undefined,
    getModelsByCapability: capability => capability === 'chat' ? [entry] : [],
    getModelsByUIVisibility: () => [],
  };
}

describe('LlmCaller 稳定错误事件链', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cancellation propagated to LLM 不分类为 provider failure、不重试也不发布 error', async () => {
    const stream = vi.fn<CanonicalInferencePort['stream']>(async function* (request) {
      yield {
        type: 'start',
        model_id: request.model_id,
        attempt_id: request.invocation.attempt_id,
      };
      yield {
        type: 'failure',
        kind: 'aborted',
        code: 'request_aborted',
        retryable: false,
      };
    });
    const caller = new LlmCaller({
      inferencePort: { stream },
      modelCatalog: createCompatibleCatalog(),
      maxRetries: 2,
      retryDelayMs: 0,
    });
    const classify = vi.spyOn(ErrorClassifier, 'classify');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emitted: AgentErrorEvent[] = [];

    await expect(caller.callWithRetries(
      'vision-model',
      [{ role: 'user', content: '继续执行' }],
      {},
      event => {
        if (event.type === 'error') emitted.push(event);
      },
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(stream).toHaveBeenCalledOnce();
    expect(classify).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('流式错误只分类一次并在 AgentEvent、RuntimeEvent、SSE 与 JSON replay 中保真', async () => {
    const stream = vi.fn<CanonicalInferencePort['stream']>();
    const inferencePort: CanonicalInferencePort = { stream };
    const caller = new LlmCaller({
      inferencePort,
      modelCatalog: createCompatibleCatalog(),
      maxRetries: 0,
    });
    const classify = vi.spyOn(ErrorClassifier, 'classify');
    const emitted: AgentErrorEvent[] = [];

    await expect(caller.callWithRetries(
      'vision-model',
      [{ role: 'user', content: '', attachments: [imageRef] }],
      {},
      event => {
        if (event.type === 'error') emitted.push(event);
      },
    )).rejects.toMatchObject({
      errorCode: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      recoverable: false,
    });

    expect(classify).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      error_code: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      retryable: false,
      details: {
        category: 'non_retryable',
        metadata: {
          active_model_id: 'vision-model',
          required_placements: ['user_image'],
          missing_conditions: ['materialization_pending'],
        },
      },
    });
    expect(emitted[0]?.details).not.toHaveProperty('stack');

    const runtimeEvent = agentEventToRuntime(emitted[0]!, {
      conversationId: 'conv-1',
      turnId: 'turn-1',
    });
    expect(runtimeEvent).not.toBeNull();

    const replayResult = validateRuntimeEvent(JSON.parse(JSON.stringify(runtimeEvent)) as unknown);
    expect(replayResult.success).toBe(true);
    if (!replayResult.success) throw new Error('RuntimeEvent replay validation failed');

    const sseEvent = runtimeEventToSSEEvent(replayResult.data);
    expect(sseEvent).not.toBeNull();
    expect(validateSSEEvent(sseEvent).success).toBe(true);
    expect(sseEvent).toMatchObject({
      type: 'error',
      error_code: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      retryable: false,
      details: {
        metadata: {
          active_model_id: 'vision-model',
          required_placements: ['user_image'],
        },
      },
    });
  });

  it.each([
    ['length', 'llm.output_limit_reached'],
    ['content_filter', 'llm.content_filtered'],
  ] as const)('canonical finish=%s 不得把不完整输出当成成功结果', async (
    finishReason,
    errorCode,
  ) => {
    const stream = vi.fn<CanonicalInferencePort['stream']>(async function* (request) {
      yield {
        type: 'start',
        model_id: request.model_id,
        attempt_id: request.invocation.attempt_id,
      };
      yield { type: 'thought_delta', text: '仍在分析' };
      yield { type: 'answer_delta', text: '尚未完成的正文' };
      yield { type: 'finish', reason: finishReason };
    });
    const caller = new LlmCaller({
      inferencePort: { stream },
      modelCatalog: createCompatibleCatalog(),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    const emitted: AgentErrorEvent[] = [];

    await expect(caller.callWithRetries(
      'vision-model',
      [{ role: 'user', content: '完成任务' }],
      {},
      event => {
        if (event.type === 'error') emitted.push(event);
      },
    )).rejects.toMatchObject({
      name: 'LlmIncompleteOutputError',
      errorCode,
      recoverable: false,
      metadata: { finish_reason: finishReason },
    });

    expect(stream).toHaveBeenCalledOnce();
    expect(emitted).toEqual([
      expect.objectContaining({
        error_code: errorCode,
        retryable: false,
        details: expect.objectContaining({
          category: 'non_retryable',
          metadata: { finish_reason: finishReason },
        }),
      }),
    ]);
  });

  it('Phase 3 图片资源错误经分类与 durable replay 保留稳定 code 和安全详情', () => {
    const error = new LlmImageInputError(
      LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
      'Image attachment integrity verification failed.',
      {
        active_model_id: 'vision-model',
        placement: 'user_image',
        message_id: 'message-1',
        attachment_id: 'attachment-1',
        resource_id: 'asset-1',
        message_index: 2,
        attachment_index: 0,
        profile_id: 'profile-v1',
      },
    );
    const classification = ErrorClassifier.classify(error);
    const agentEvent = createLlmAgentErrorEvent(error, classification);
    const runtimeEvent = agentEventToRuntime(agentEvent, {
      conversationId: 'conv-1',
      turnId: 'turn-1',
    });

    expect(runtimeEvent).not.toBeNull();
    const replay = validateRuntimeEvent(JSON.parse(JSON.stringify(runtimeEvent)) as unknown);
    expect(replay.success).toBe(true);
    if (!replay.success) throw new Error('RuntimeEvent replay validation failed');

    expect(replay.data).toMatchObject({
      type: 'error',
      error_code: LLM_IMAGE_INPUT_ERROR_CODES.ATTACHMENT_INTEGRITY_FAILED,
      retryable: false,
      details: {
        metadata: {
          active_model_id: 'vision-model',
          attachment_id: 'attachment-1',
          resource_id: 'asset-1',
        },
      },
    });
    expect(JSON.stringify(replay.data)).not.toMatch(/sha256|local_path|base64|data:image|bytes/);
  });
});
