import { APICallError, InvalidResponseDataError } from 'ai';
import { describe, expect, it } from 'vitest';
import { projectAiSdkFailureObservation } from '../functions/projectAiSdkFailureObservation';
import {
  PROVIDER_ERROR_EXCERPT_MAX_CHARS,
  projectProviderErrorExcerpt,
  redactProviderErrorText,
} from '../functions/projectProviderErrorExcerpt';

function apiError(statusCode: number | undefined, responseBody: string | undefined): APICallError {
  return new APICallError({
    message: 'Bad Request',
    url: 'https://provider.example/v1/chat/completions?key=url-secret',
    requestBodyValues: { messages: [{ role: 'user', content: 'private user prompt' }] },
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(responseBody === undefined ? {} : { responseBody }),
    responseHeaders: { authorization: 'Bearer header-secret' },
  });
}

describe('Provider 拒绝原因摘录', () => {
  it('只取 JSON 错误说明，不带出请求、URL、响应头或 envelope 的其他字段', () => {
    const body = JSON.stringify({
      error: { message: 'Image at index 3 exceeds the size limit', type: 'invalid_request_error', param: 'private user prompt' },
      echoed_request: { messages: ['private user prompt'] },
    });
    const excerpt = projectProviderErrorExcerpt(apiError(400, body));
    expect(excerpt).toBe('Image at index 3 exceeds the size limit');
    expect(projectProviderErrorExcerpt(apiError(400, JSON.stringify({ message: '上下文过长' })))).toBe('上下文过长');
    expect(projectProviderErrorExcerpt(apiError(400, JSON.stringify({ detail: 'model not found' })))).toBe('model not found');
    // 没有说明字段的 JSON 不整体写入日志。
    expect(projectProviderErrorExcerpt(apiError(400, JSON.stringify({ choices: [{ text: 'private user prompt' }] })))).toBeUndefined();
  });

  it('删除凭据、认证头、长令牌与 data URL', () => {
    const text = [
      'Incorrect API key provided: sk-proj-AbCdEf1234567890.',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'api_key=plainsecret123&x=1',
      'image data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgL',
      'token abcdEFGHijklMNOPqrstUVWXyz0123456789ab',
    ].join('\n');
    const redacted = redactProviderErrorText(text) ?? '';
    for (const secret of ['sk-proj-AbCdEf1234567890', 'eyJhbGciOiJIUzI1NiJ9', 'plainsecret123', '/9j/4AAQ', 'abcdEFGHijklMNOPqrstUVWXyz0123456789ab']) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('Authorization: [redacted]');
    expect(redactProviderErrorText('upstream said Bearer abc.def')).toBe('upstream said Bearer [redacted]');
    expect(redacted).toContain('[data-url]');
    expect(redacted).not.toContain('\n');
    // 普通说明里的模型名与数字保留，便于判断原因。
    expect(redactProviderErrorText('model deepseek-v4.1-flash: maximum context length is 128000 tokens'))
      .toBe('model deepseek-v4.1-flash: maximum context length is 128000 tokens');
  });

  it('按字符限长并标出截断；纯文本正文同样脱敏、限长', () => {
    const long = '错'.repeat(PROVIDER_ERROR_EXCERPT_MAX_CHARS + 50);
    const excerpt = projectProviderErrorExcerpt(apiError(502, `<html>${long}</html>`)) ?? '';
    expect(Array.from(excerpt)).toHaveLength(PROVIDER_ERROR_EXCERPT_MAX_CHARS + 1);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('成功状态、没有状态或正文、非 HTTP 错误都不摘录', () => {
    expect(projectProviderErrorExcerpt(apiError(200, '{"error":{"message":"x"}}'))).toBeUndefined();
    expect(projectProviderErrorExcerpt(apiError(undefined, '{"error":{"message":"x"}}'))).toBeUndefined();
    expect(projectProviderErrorExcerpt(apiError(400, '   '))).toBeUndefined();
    expect(projectProviderErrorExcerpt(new InvalidResponseDataError({ data: { error: { message: 'x' } } }))).toBeUndefined();
    expect(projectProviderErrorExcerpt(new Error('{"error":{"message":"x"}}'))).toBeUndefined();
  });

  it('进入安全诊断，canonical failure 不变', () => {
    const observation = projectAiSdkFailureObservation(
      apiError(400, JSON.stringify({ error: { message: 'Invalid image content', type: 'invalid_request_error' } })),
      undefined,
      'provider_call',
    );
    expect(observation.diagnostic.provider_error_excerpt).toBe('Invalid image content');
    expect(observation.failure).not.toHaveProperty('provider_error_excerpt');
    expect(JSON.stringify(observation)).not.toContain('private user prompt');
    expect(JSON.stringify(observation)).not.toContain('secret');
  });
});
