import { APICallError, JSONParseError, StreamProviderError, TypeValidationError } from 'ai';
import { describe, expect, it } from 'vitest';
import { AiSdkHostStreamInvariantError } from '../definitions/aiSdkHostStreamInvariantError';
import { classifyAiSdkFailure } from '../functions/classifyAiSdkFailure';
import { projectAiSdkFailureObservation } from '../functions/projectAiSdkFailureObservation';

describe('classifyAiSdkFailure', () => {
  it('把 Provider HTTP 错误投影为稳定安全分类', () => {
    const error = new APICallError({
      message: 'sensitive upstream body',
      url: 'https://fixture.invalid/v1/embeddings',
      requestBodyValues: { input: ['secret prompt'] },
      statusCode: 503,
      responseHeaders: {},
      responseBody: 'sensitive response',
      isRetryable: true,
    });

    expect(classifyAiSdkFailure(error, undefined)).toEqual({
      kind: 'provider',
      code: 'provider_http_503',
      retryable: true,
    });
  });

  it('保留无 HTTP response 的 AI SDK transport 重试语义', () => {
    const error = new APICallError({
      message: 'network connection failed',
      url: 'https://fixture.invalid/v1/chat/completions',
      requestBodyValues: { messages: ['secret prompt'] },
      isRetryable: true,
    });

    expect(classifyAiSdkFailure(error, undefined)).toEqual({
      kind: 'transport',
      code: 'provider_transport_error',
      retryable: true,
    });
  });

  it('无 HTTP status 的确定性 API 错误仍不可重试', () => {
    const error = new APICallError({
      message: 'provider request could not be constructed',
      url: 'https://fixture.invalid/v1/chat/completions',
      requestBodyValues: { messages: ['secret prompt'] },
      isRetryable: false,
    });

    expect(classifyAiSdkFailure(error, undefined)).toEqual({
      kind: 'provider',
      code: 'provider_api_error',
      retryable: false,
    });
  });

  it('把产品特有错误交给 Host 分类器且不向 canonical failure 泄露原始正文', () => {
    const error = new APICallError({
      message: 'provider rejected request',
      url: 'https://fixture.invalid/v1/responses',
      requestBodyValues: { input: 'secret prompt' },
      statusCode: 400,
      responseHeaders: {},
      responseBody: 'fixture product quota marker and sensitive account detail',
      isRetryable: false,
    });

    const failure = classifyAiSdkFailure(error, undefined, 'provider_call', {
      classify(candidate) {
        return candidate.response_body?.includes('fixture product quota marker')
          ? { kind: 'provider', code: 'fixture_quota_exhausted', retryable: false }
          : undefined;
      },
    });

    expect(failure).toEqual({
      kind: 'provider',
      code: 'fixture_quota_exhausted',
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain('sensitive account detail');
  });

  it.each([
    ['User location is not supported for this route', 'provider_location_restricted'],
    ['Assistant message is missing a `thought_signature`', 'provider_continuation_rejected'],
  ])('把可切模型的 Provider 语义收敛为无敏感信息 code', (body, code) => {
    const error = new APICallError({
      message: 'provider rejected request',
      url: 'https://fixture.invalid/v1/chat/completions',
      requestBodyValues: { messages: ['secret prompt'] },
      statusCode: 400,
      responseHeaders: {},
      responseBody: body,
      isRetryable: false,
    });

    expect(classifyAiSdkFailure(error, undefined)).toEqual({
      kind: 'provider',
      code,
      retryable: false,
    });
  });

  it('把流式结构化 Provider 错误识别为可重试上游故障且不传播 message', () => {
    const failure = classifyAiSdkFailure(
      {
        type: 'server_error',
        code: 'upstream_error',
        message: 'sensitive upstream response',
      },
      undefined,
      'provider_stream'
    );

    expect(failure).toEqual({
      kind: 'provider',
      code: 'provider_stream_unavailable',
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain('sensitive upstream response');
  });

  it('把没有 HTTP status 的限流流事件收敛为稳定分类', () => {
    expect(
      classifyAiSdkFailure(
        {
          type: 'rate_limit_error',
          message: 'provider-specific details',
        },
        undefined,
        'provider_stream'
      )
    ).toEqual({
      kind: 'provider',
      code: 'provider_stream_rate_limited',
      retryable: true,
    });
  });

  it('按 AI SDK 7 的 StreamProviderError 安全字段分类且不传播正文或 data', () => {
    const observation = projectAiSdkFailureObservation(
      new StreamProviderError({
        message: 'sensitive upstream response',
        type: 'server_error',
        code: 'upstream_error',
        isRetryable: true,
        data: { account: 'sensitive account detail' },
      }),
      undefined,
      'provider_stream'
    );

    expect(observation).toEqual({
      failure: {
        kind: 'provider',
        code: 'provider_stream_unavailable',
        retryable: true,
      },
      diagnostic: {
        phase: 'provider_stream',
        error_shape: 'stream_provider_error',
      },
    });
    expect(JSON.stringify(observation)).not.toContain('sensitive');
  });

  it('识别 OpenAI Responses 在已有输出后的嵌套 response.failed', () => {
    const failure = classifyAiSdkFailure(
      {
        type: 'response.failed',
        sequence_number: 7,
        response: {
          error: {
            code: 'server_error',
            message: 'sensitive upstream response',
          },
          incomplete_details: null,
        },
      },
      undefined,
      'provider_stream'
    );

    expect(failure).toEqual({
      kind: 'provider',
      code: 'provider_stream_unavailable',
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain('sensitive upstream response');
  });

  it('没有具体 code 的 OpenAI response.failed 仍保持 SDK 的 500 重试语义', () => {
    expect(
      classifyAiSdkFailure(
        {
          type: 'response.failed',
          sequence_number: 8,
          response: {
            error: null,
            incomplete_details: null,
          },
        },
        undefined,
        'provider_stream'
      )
    ).toEqual({
      kind: 'provider',
      code: 'provider_stream_unavailable',
      retryable: true,
    });
  });

  it('区分 SDK response schema 与 JSON 解码失败', () => {
    const schemaError = new TypeValidationError({
      value: { secret: 'response body' },
      cause: new Error('invalid shape'),
    });
    const jsonError = new JSONParseError({
      text: 'sensitive invalid json',
      cause: new Error('invalid json'),
    });

    expect(classifyAiSdkFailure(schemaError, undefined, 'provider_stream')).toEqual({
      kind: 'protocol',
      code: 'provider_response_schema_invalid',
      retryable: false,
    });
    expect(classifyAiSdkFailure(jsonError, undefined, 'provider_stream')).toEqual({
      kind: 'protocol',
      code: 'provider_response_json_invalid',
      retryable: false,
    });
  });

  it('区分 Host 请求投影、确定性生命周期违规与未知上游 stream error', () => {
    expect(
      classifyAiSdkFailure(new Error('continuation mismatch'), undefined, 'request_projection')
    ).toEqual({
      kind: 'protocol',
      code: 'host_request_projection_error',
      retryable: false,
    });
    expect(
      classifyAiSdkFailure(
        new AiSdkHostStreamInvariantError('text_delta_without_start'),
        undefined,
        'provider_stream'
      )
    ).toEqual({
      kind: 'protocol',
      code: 'provider_stream_lifecycle_invalid',
      retryable: false,
    });
    expect(
      classifyAiSdkFailure(
        new Error('sensitive gateway disconnect detail'),
        undefined,
        'provider_stream'
      )
    ).toEqual({
      kind: 'transport',
      code: 'provider_stream_error',
      retryable: true,
    });
  });

  it('安全 observation 只保留白名单 shape，不传播异常正文', () => {
    const observation = projectAiSdkFailureObservation(
      new Error('sensitive gateway disconnect detail'),
      undefined,
      'provider_stream'
    );

    expect(observation).toEqual({
      failure: {
        kind: 'transport',
        code: 'provider_stream_error',
        retryable: true,
      },
      diagnostic: {
        phase: 'provider_stream',
        error_shape: 'plain_error',
      },
    });
    expect(JSON.stringify(observation)).not.toContain('sensitive gateway disconnect detail');
  });
});
