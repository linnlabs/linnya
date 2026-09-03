import { describe, expect, it } from 'vitest';

import {
  ENGINE_ERROR_CODES,
  ErrorCategory,
  ErrorClassifier,
} from '../errorClassifier';

describe('ErrorClassifier contract', () => {
  it('exposes stable engine error codes', () => {
    expect(ENGINE_ERROR_CODES).toMatchObject({
      LLM_RATE_LIMIT: 'llm.rate_limit',
      LLM_INVALID_TOOL_ARGS: 'llm.invalid_tool_args',
      LLM_PROVIDER_DOWN: 'llm.provider_down',
      LLM_UNSUPPORTED_CAPABILITY: 'llm.unsupported_capability',
      LLM_AUTH_FAILED: 'llm.auth_failed',
      LLM_INVALID_REQUEST: 'llm.invalid_request',
      LLM_RESOURCE_NOT_FOUND: 'llm.resource_not_found',
      TOOL_TIMEOUT: 'tool.timeout',
      ENGINE_UNKNOWN: 'engine.unknown',
    });
  });

  it('returns structured metadata for retryable llm tool-args corruption', () => {
    const result = ErrorClassifier.classify(
      new Error('invalid tool_call.arguments: trailing comma'),
    );

    expect(result).toEqual({
      category: ErrorCategory.RETRYABLE,
      reason: '模型输出损坏: invalid tool_call.arguments',
      suggestedDelay: 1000,
      errorCode: ENGINE_ERROR_CODES.LLM_INVALID_TOOL_ARGS,
      recoverable: true,
      retryAfterMs: 1000,
      hint: 'retry_with_same_request',
      metadata: {
        matchedPattern: 'invalid tool_call.arguments',
      },
    });
  });

  it('prioritizes an error object structured contract over misleading message text', () => {
    const error = Object.assign(new Error('network timeout'), {
      errorCode: 'llm.image_input.placement_unsupported',
      recoverable: false,
      metadata: {
        active_model_id: 'text-only-model',
        required_placements: ['user_image'],
      },
    });

    expect(ErrorClassifier.classify(error)).toEqual({
      category: ErrorCategory.NON_RETRYABLE,
      reason: '结构化错误: llm.image_input.placement_unsupported',
      suggestedDelay: null,
      errorCode: 'llm.image_input.placement_unsupported',
      recoverable: false,
      metadata: {
        active_model_id: 'text-only-model',
        required_placements: ['user_image'],
      },
    });
  });

  it('returns structured metadata for rate-limit errors', () => {
    const result = ErrorClassifier.classify(new Error('429 rate limit exceeded'));

    expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_RATE_LIMIT);
    expect(result.recoverable).toBe(true);
    expect(result.retryAfterMs).toBe(1000);
    expect(result.hint).toBe('retry_with_backoff');
    expect(result.metadata).toEqual({
      matchedPattern: 'rate limit',
    });
  });

  it('does not treat unrelated numeric noise as HTTP request status', () => {
    const result = ErrorClassifier.classify(new Error('fetch failed after elapsed 400ms'));

    expect(result.category).toBe(ErrorCategory.RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN);
    expect(result.metadata).toEqual({
      matchedPattern: 'fetch failed',
    });
  });

  it('does not report a local process terminal assertion as a provider outage', () => {
    const result = ErrorClassifier.classify(
      new Error('cancelled terminal must remain terminated after replay'),
    );

    expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.ENGINE_UNKNOWN);
    expect(result.recoverable).toBe(false);
    expect(result.metadata).toEqual({
      matchedPattern: 'fallback',
    });
  });

  it('keeps the exact undici terminated error retryable', () => {
    const result = ErrorClassifier.classify(new TypeError('terminated'));

    expect(result.category).toBe(ErrorCategory.RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN);
    expect(result.recoverable).toBe(true);
    expect(result.metadata).toEqual({
      matchedPattern: 'terminated',
    });
  });

  it('keeps a structured undici socket failure retryable', () => {
    const error = new TypeError('request stream failed');
    Object.defineProperty(error, 'cause', {
      value: {
        name: 'SocketError',
        message: 'remote stream ended',
        code: 'UND_ERR_SOCKET',
      },
    });

    const result = ErrorClassifier.classify(error);

    expect(result.category).toBe(ErrorCategory.RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_PROVIDER_DOWN);
    expect(result.recoverable).toBe(true);
    expect(result.metadata).toEqual({
      matchedPattern: 'UND_ERR_SOCKET',
    });
  });

  it('uses structured HTTP status when the provider exposes one', () => {
    const error = Object.assign(new Error('provider rejected request after elapsed 17ms'), {
      status: 400,
    });

    const result = ErrorClassifier.classify(error);

    expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_INVALID_REQUEST);
    expect(result.metadata).toEqual({
      matchedPattern: '400',
      httpStatus: 400,
    });
  });

  it('calculates retry delay from an existing classification without reclassifying', () => {
    const classification = ErrorClassifier.classify(new Error('429 rate limit exceeded'));

    expect(ErrorClassifier.calculateRetryDelay(classification, 2, 1000, 60_000)).toBe(4000);
  });

  it('returns structured metadata for auth failures', () => {
    const result = ErrorClassifier.classify(new Error('invalid api key'));

    expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.LLM_AUTH_FAILED);
    expect(result.recoverable).toBe(false);
    expect(result.retryAfterMs).toBeUndefined();
    expect(result.hint).toBe('check_credentials');
  });

  it('falls back to engine.unknown for unclassified errors', () => {
    const result = ErrorClassifier.classify(new Error('totally unexpected boom'));

    expect(result.category).toBe(ErrorCategory.NON_RETRYABLE);
    expect(result.errorCode).toBe(ENGINE_ERROR_CODES.ENGINE_UNKNOWN);
    expect(result.recoverable).toBe(false);
    expect(result.metadata).toEqual({
      matchedPattern: 'fallback',
    });
  });
});
