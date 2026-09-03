import { describe, expect, it } from 'vitest';
import { classifyLinnyaProviderFailure } from './classifyLinnyaProviderFailure';

describe('classifyLinnyaProviderFailure', () => {
  it.each([
    { kind: 'api_call' as const, response_body: '今日使用次数已达上限（账户详情）' },
    { kind: 'decoded_stream' as const, code: 'insufficient_quota' },
  ])('把 Linnya 配额拒绝收敛为产品稳定错误码', candidate => {
    const failure = classifyLinnyaProviderFailure({
      phase: 'provider_call',
      ...candidate,
    });

    expect(failure).toEqual({
      kind: 'provider',
      code: 'cloud_quota_exhausted',
      retryable: false,
    });
    expect(JSON.stringify(failure)).not.toContain('账户详情');
  });
});
