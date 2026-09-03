import { describe, expect, it } from 'vitest';
import type { ConversationMessageResolver } from '../definitions/conversationMessages';
import {
  normalizeConversationError,
  normalizeHttpErrorPayload,
} from './errorNormalizer';

const translated: ConversationMessageResolver = (key, params) => {
  if (key === 'conversation.error.rateLimit') return 'translated-rate-limit';
  if (key === 'conversation.error.providerLimit') return 'translated-provider-limit';
  if (key === 'conversation.error.http502') return 'translated-http-502';
  if (key === 'conversation.error.generic') return 'translated-generic';
  if (key === 'conversation.error.providerUnavailable') return 'translated-provider-unavailable';
  if (key === 'conversation.error.thinkingProtocolMismatch') return 'translated-thinking-mismatch';
  if (key === 'conversation.error.outputLimitReached') return 'translated-output-limit';
  if (key === 'conversation.error.contentFiltered') return 'translated-content-filtered';
  if (key === 'conversation.error.imageModelUnsupported') return 'translated-image-model-unsupported';
  if (key === 'conversation.error.imageModelUnsupportedWithAlternatives') {
    return `translated-image-model-alternatives:${String(params?.models)}`;
  }
  if (key === 'conversation.error.imagePlacementUnsupported') return 'translated-image-placement-unsupported';
  if (key === 'conversation.error.imagePlacementUnsupportedWithAlternatives') {
    return `translated-image-placement-alternatives:${String(params?.models)}`;
  }
  if (key === 'conversation.error.userImagePlacementUnsupportedWithAlternatives') {
    return `translated-user-image-placement-alternatives:${String(params?.models)}`;
  }
  if (key === 'conversation.error.toolResultImagePlacementUnsupported') {
    return 'translated-tool-image-placement';
  }
  if (key === 'conversation.error.imageMaterializationPending') return 'translated-image-pending';
  if (key === 'conversation.error.imageAttachmentUnavailable') return 'translated-image-unavailable';
  if (key === 'conversation.error.imageAttachmentIntegrityFailed') return 'translated-image-integrity';
  if (key === 'conversation.error.imageRouteLimitExceeded') return 'translated-image-limit';
  if (key === 'conversation.error.imageMappingUnsupported') return 'translated-image-mapping';
  if (key === 'conversation.error.imageContextBudgetExceeded') return 'translated-image-budget';
  if (key === 'conversation.error.quotaExceeded') return 'translated-quota-exceeded';
  if (key === 'conversation.error.auth') return 'translated-auth';
  if (key === 'conversation.error.badRequest') return 'translated-bad-request';
  return params ? `${key}:${JSON.stringify(params)}` : key;
};

describe('errorNormalizer', () => {
  it('uses injected resolver for HTTP error messages', () => {
    const result = normalizeHttpErrorPayload({ status: 429 }, { resolveMessage: translated });

    expect(result.userMessage).toBe('translated-rate-limit');
    expect(result.errorCode).toBe('HTTP_429');
  });

  it('uses localized quota message instead of backend raw Chinese text', () => {
    const result = normalizeHttpErrorPayload({
      status: 403,
      bodyText: JSON.stringify({ message: '已达上限，请明天再试' }),
    }, { resolveMessage: translated });

    expect(result.userMessage).toBe('translated-quota-exceeded');
    expect(result.rawMessage).toBe('已达上限，请明天再试');
  });

  it('uses injected resolver for SSE HTTP status messages', () => {
    const result = normalizeConversationError(
      { error_code: 'HTTP_502', error: 'upstream failed' },
      { resolveMessage: translated },
    );

    expect(result.userMessage).toBe('translated-http-502');
  });

  it('maps canonical provider 429 without exposing it as a generic error', () => {
    const result = normalizeConversationError(
      {
        error_code: 'llm.provider_http_429',
        error: 'Canonical inference failed: provider_http_429',
        retryable: true,
      },
      { resolveMessage: translated },
    );

    expect(result).toMatchObject({
      userMessage: 'translated-provider-limit',
      errorCode: 'llm.provider_http_429',
      retryable: true,
    });
  });

  it.each([
    ['llm.output_limit_reached', 'translated-output-limit'],
    ['llm.content_filtered', 'translated-content-filtered'],
  ] as const)('maps incomplete output code %s to a terminal user-facing error', (
    errorCode,
    expectedMessage,
  ) => {
    expect(normalizeConversationError(
      { error_code: errorCode, error: 'internal detail', retryable: false },
      { resolveMessage: translated },
    )).toMatchObject({
      userMessage: expectedMessage,
      errorCode,
      retryable: false,
    });
  });

  it('keeps unknown short backend messages as diagnostics only', () => {
    const result = normalizeConversationError(
      { error: '自定义用户提示' },
      { resolveMessage: translated },
    );

    expect(result.userMessage).toBe('translated-generic');
    expect(result.rawMessage).toBe('自定义用户提示');
  });

  it('uses injected resolver for technical fallback messages', () => {
    const result = normalizeConversationError(
      { error: '{"detail":"stack trace"}' },
      { resolveMessage: translated },
    );

    expect(result.userMessage).toBe('translated-generic');
  });

  it('uses structured runtime error codes for provider, rate limit, auth and request errors', () => {
    expect(normalizeConversationError(
      { error_code: 'llm.provider_down', error: 'provider failed' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-provider-unavailable');
    expect(normalizeConversationError(
      { error_code: 'llm.rate_limit', error: 'request failed' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-rate-limit');
    expect(normalizeConversationError(
      { error_code: 'llm.auth_failed', error: 'request failed' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-auth');
    expect(normalizeConversationError(
      { error_code: 'llm.invalid_request', error: 'request failed' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-bad-request');
  });

  it('maps all image input codes and carries safe compatible model ids', () => {
    const modelUnsupported = normalizeConversationError({
      type: 'error',
      error: 'internal model capability detail',
      error_code: 'llm.image_input.model_unsupported',
      retryable: false,
      details: {
        metadata: {
          compatible_model_ids: ['vision-a', 'vision-a', 'vision-b'],
        },
      },
    }, { resolveMessage: translated });
    const placementUnsupported = normalizeConversationError({
      type: 'error',
      error_code: 'llm.image_input.placement_unsupported',
      details: {
        classification: {
          metadata: {
            compatible_model_ids: ['vision-c'],
            required_placements: ['user_image'],
          },
        },
      },
    }, { resolveMessage: translated });
    const pending = normalizeConversationError({
      type: 'error',
      error_code: 'llm.image_input.materialization_pending',
    }, { resolveMessage: translated });

    expect(modelUnsupported).toMatchObject({
      userMessage: 'translated-image-model-alternatives:vision-a, vision-b',
      retryable: false,
      compatibleModelIds: ['vision-a', 'vision-b'],
    });
    expect(placementUnsupported).toMatchObject({
      userMessage: 'translated-user-image-placement-alternatives:vision-c',
      retryable: false,
      compatibleModelIds: ['vision-c'],
      requiredImagePlacements: ['user_image'],
    });
    expect(pending.userMessage).toBe('translated-image-pending');
  });

  it('工具结果图片位置失败时保留该来源的精确提示', () => {
    const result = normalizeConversationError({
      error_code: 'llm.image_input.placement_unsupported',
      details: {
        metadata: { required_placements: ['tool_result_image'] },
      },
    }, { resolveMessage: translated });

    expect(result).toMatchObject({
      userMessage: 'translated-tool-image-placement',
      requiredImagePlacements: ['tool_result_image'],
    });
  });

  it('draft commit 图片错误进入全局错误链时复用附件本地化映射', () => {
    const result = normalizeConversationError({
      error: 'draft missing',
      error_code: 'conversation.image.draft_not_found',
      retryable: false,
    });

    expect(result).toMatchObject({
      userMessage: '图片草稿已失效，请重新添加。',
      errorCode: 'conversation.image.draft_not_found',
      retryable: false,
      rawMessage: 'draft missing',
    });
  });

  it('gives live SSE and durable JSON replay the same localized image error', () => {
    const liveEvent = {
      type: 'error',
      error: '{"provider":"raw-body"}',
      error_code: 'llm.image_input.model_unsupported',
      retryable: false,
      details: {
        metadata: { compatible_model_ids: ['vision-model'] },
      },
    };
    const replayEvent = JSON.parse(JSON.stringify(liveEvent)) as unknown;

    const live = normalizeConversationError(liveEvent, { resolveMessage: translated });
    const replay = normalizeConversationError(replayEvent, { resolveMessage: translated });

    expect(replay.userMessage).toBe(live.userMessage);
    expect(replay.errorCode).toBe(live.errorCode);
    expect(replay.retryable).toBe(live.retryable);
    expect(live.userMessage).not.toContain('raw-body');
  });

  it('maps Phase 3 image resource, route, mapping and budget errors without exposing raw details', () => {
    const cases = [
      ['llm.image_input.attachment_unavailable', 'translated-image-unavailable'],
      ['llm.image_input.attachment_integrity_failed', 'translated-image-integrity'],
      ['llm.image_input.route_limit_exceeded', 'translated-image-limit'],
      ['llm.image_input.mapping_unsupported', 'translated-image-mapping'],
      ['llm.image_input.context_budget_exceeded', 'translated-image-budget'],
    ] as const;

    for (const [errorCode, expectedMessage] of cases) {
      const result = normalizeConversationError({
        type: 'error',
        error_code: errorCode,
        error: 'sensitive internal detail',
        retryable: false,
      }, { resolveMessage: translated });

      expect(result.userMessage).toBe(expectedMessage);
      expect(result.userMessage).not.toContain('sensitive');
      expect(result.retryable).toBe(false);
    }
  });

  it('does not classify incidental status numbers or permission words in unstructured messages', () => {
    const messages = [
      'Processed 502 records before the tool failed',
      'The request mentions 429 items',
      'Could not preserve the permission label in generated text',
    ];

    for (const error of messages) {
      expect(normalizeConversationError(
        { error },
        { resolveMessage: translated },
      ).userMessage).toBe('translated-generic');
    }
  });

  it('keeps narrow thinking and quota semantics ahead of generic transport codes', () => {
    expect(normalizeConversationError(
      { error_code: 'HTTP_429', error: 'Expected `thinking` block before redacted_thinking' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-thinking-mismatch');
    expect(normalizeConversationError(
      { error_code: 'llm.provider_down', error: '该模型已达上限，请明天再试' },
      { resolveMessage: translated },
    ).userMessage).toBe('translated-quota-exceeded');
  });
});
