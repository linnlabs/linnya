import { APICallError, InvalidResponseDataError, TypeValidationError } from 'ai';
import { describe, expect, it } from 'vitest';
import { classifyAiSdkFailure } from '../functions/classifyAiSdkFailure';
import { projectAiSdkFailureObservation } from '../functions/projectAiSdkFailureObservation';

describe('响应失败的重试边界', () => {
  it('只有流中无数据的结束异常按不完整处理，具体无效数据和请求侧异常仍停止', () => {
    const missing = new InvalidResponseDataError({ data: undefined, message: 'fixture detail' });
    expect(classifyAiSdkFailure(missing, undefined, 'provider_stream')).toEqual({
      kind: 'transport',
      code: 'provider_stream_truncated',
      retryable: true,
    });
    for (const [error, phase] of [
      [new InvalidResponseDataError({ data: { secret: 'private response' } }), 'provider_stream'],
      [missing, 'request_projection'],
    ] as const) {
      expect(classifyAiSdkFailure(error, undefined, phase)).toEqual({
        kind: 'protocol',
        code: 'provider_response_data_invalid',
        retryable: false,
      });
    }
    expect(
      projectAiSdkFailureObservation(missing, undefined, 'provider_stream').diagnostic
    ).toEqual({
      phase: 'provider_stream',
      error_shape: 'invalid_response_data_error',
      sdk_error_details: { response_data_state: 'absent' },
    });
  });

  it.each([
    [{ code: 'timeout' }, 'provider_stream_timeout', true],
    [{ type: 'rate_limit_error' }, 'provider_stream_rate_limited', true],
    [{ status: 401 }, 'provider_http_401', false],
    [{ code: 'context_length_exceeded' }, 'provider_request_too_large', false],
  ] as const)('缺少 message 的错误对象仍保留已知语义：%j', (error, code, retryable) => {
    const malformed = new TypeValidationError({
      value: { error },
      cause: new Error('sensitive validation details'),
    });
    expect(classifyAiSdkFailure(malformed, undefined, 'provider_stream')).toMatchObject({
      code,
      retryable,
    });
    // 本地请求投影失败不能被携带的上游形状升级为一次额外调用。
    expect(classifyAiSdkFailure(malformed, undefined, 'request_projection')).toMatchObject({
      code: 'provider_response_schema_invalid',
      retryable: false,
    });
  });

  it('未知 envelope 的自报 retryable 和正文中的 timeout 都不能绕过 schema 拒绝', () => {
    for (const value of [
      { error: { code: 'unknown_error', retryable: true } },
      { choices: [{ delta: { content: 123 } }], private: 'timeout' },
      { error: { message: 'timeout' } },
    ]) {
      const observation = projectAiSdkFailureObservation(
        new TypeValidationError({ value, cause: new Error('timeout in private payload') }),
        undefined,
        'provider_stream'
      );
      expect(observation.failure).toEqual({
        kind: 'protocol',
        code: 'provider_response_schema_invalid',
        retryable: false,
      });
      expect(observation.diagnostic.error_shape).toBe('response_schema_error');
      expect(JSON.stringify(observation)).not.toContain('private payload');
    }
  });

  it('HTTP成功后的传输断开可重试，但相同 cause 不能覆盖 HTTP401 或解码错误', () => {
    const responseError = (status: number, cause: unknown) =>
      new APICallError({
        message: 'sensitive request/response',
        url: 'https://fixture.invalid',
        requestBodyValues: { private: 'prompt' },
        statusCode: status,
        cause,
      });
    const reset = responseError(200, new TypeError('private socket detail'));
    const observation = projectAiSdkFailureObservation(reset, undefined, 'provider_stream');
    expect(observation.failure).toEqual({
      kind: 'transport',
      code: 'provider_response_read_error',
      retryable: true,
    });
    expect(observation.diagnostic.sdk_error_details).toEqual({
      http_status: 200,
      cause_shape: 'transport_type_error',
      sdk_retryable: false,
    });
    expect(JSON.stringify(observation)).not.toContain('private');
    expect(
      classifyAiSdkFailure(
        responseError(
          200,
          Object.assign(new Error('private socket detail'), { code: 'ECONNRESET' })
        ),
        undefined,
        'provider_stream'
      )
    ).toMatchObject({ code: 'provider_response_read_error', retryable: true });
    expect(
      classifyAiSdkFailure(responseError(401, reset.cause), undefined, 'provider_stream')
    ).toMatchObject({ code: 'provider_http_401', retryable: false });
    expect(
      classifyAiSdkFailure(
        responseError(
          200,
          new TypeValidationError({
            value: { secret: 'response' },
            cause: new Error('invalid field'),
          })
        ),
        undefined,
        'provider_stream'
      )
    ).toMatchObject({ code: 'provider_response_schema_invalid', retryable: false });
    expect(
      classifyAiSdkFailure(responseError(200, new Error('unknown')), undefined, 'provider_stream')
    ).toMatchObject({ code: 'provider_response_invalid', retryable: false });
  });

  it('用户取消优先于所有可重试响应失败', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      classifyAiSdkFailure(
        new InvalidResponseDataError({ data: undefined }),
        controller.signal,
        'provider_stream'
      )
    ).toEqual({ kind: 'aborted', code: 'request_aborted', retryable: false });
  });
});
