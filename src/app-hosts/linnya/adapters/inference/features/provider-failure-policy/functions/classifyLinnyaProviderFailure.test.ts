import { describe, expect, it } from 'vitest';
import type { AiSdkProviderFailureCandidate } from '@linnlabs/linnkit-provider-ai-sdk';
import { classifyLinnyaProviderFailure } from './classifyLinnyaProviderFailure';

describe('classifyLinnyaProviderFailure', () => {
  it.each([
    { kind: 'api_call' as const, response_body: '今日使用次数已达上限（账户详情）' },
    { kind: 'decoded_stream' as const, code: 'insufficient_quota' },
  ])('把 Linnya 配额拒绝收敛为产品稳定错误码', candidate => {
    const failure = classifyLinnyaProviderFailure({
      phase: 'provider_call',
      ...candidate,
    }, 'linnya-cloud');

    expect(failure).toEqual({
      kind: 'provider',
      code: 'cloud_quota_exhausted',
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain('账户详情');
  });

  it.each([
    {
      kind: 'api_call',
      status_code: 400,
      response_body: JSON.stringify({ error: { type: 'MissingSessionID', message: 'private account detail' } }),
    },
    { kind: 'decoded_stream', type: 'missingsessionid' },
  ] satisfies readonly Omit<AiSdkProviderFailureCandidate, 'phase'>[])(
    '只按结构化类型识别 OpenCode 缺失会话标识且不传播正文', candidate => {
      expect(classifyLinnyaProviderFailure({ phase: 'provider_call', ...candidate }, 'opencode-go')).toEqual({
        kind: 'provider', code: 'opencode_session_required', retryable: false,
      });
    }
  );

  it.each([
    { kind: 'api_call', status_code: 400, response_body: 'MissingSessionID' },
    { kind: 'api_call', status_code: 400, response_body: JSON.stringify({ error: { message: 'MissingSessionID' } }) },
    { kind: 'api_call', status_code: 400, response_body: JSON.stringify({ error: { type: 'invalid_request' } }) },
    { kind: 'api_call', status_code: 400, response_body: JSON.stringify({ error: { type: ['MissingSessionID'] } }) },
    { kind: 'api_call', status_code: 500, response_body: JSON.stringify({ error: { type: 'MissingSessionID' } }) },
    { kind: 'decoded_stream', code: 'MissingSessionID' },
    { kind: 'decoded_stream', type: 'OtherMissingSessionID' },
    { kind: 'decoded_stream', status_code: 401, type: 'MissingSessionID' },
  ] satisfies readonly Omit<AiSdkProviderFailureCandidate, 'phase'>[])(
    '其它拒绝不被猜测成会话标识缺失', candidate => {
      expect(classifyLinnyaProviderFailure({ phase: 'provider_call', ...candidate }, 'opencode-go')).toBeUndefined();
    }
  );
});
