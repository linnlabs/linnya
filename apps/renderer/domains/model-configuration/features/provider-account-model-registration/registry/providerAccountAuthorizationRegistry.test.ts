import { describe, expect, it } from 'vitest';

import { ProviderAccountAuthorizationError } from '../definitions/providerAccountAuthorizationError';
import { resolveProviderAccountAuthorizationOperations } from './providerAccountAuthorizationRegistry';

describe('providerAccountAuthorizationRegistry', () => {
  it('按 connection ID 解析账号授权能力，并拒绝未注册的账号型 connection', () => {
    const operations = resolveProviderAccountAuthorizationOperations('openai-chatgpt-subscription');

    expect(operations).toEqual(
      expect.objectContaining({
        getStatus: expect.any(Function),
        authorize: expect.any(Function),
        disconnect: expect.any(Function),
      })
    );
    expect(() => resolveProviderAccountAuthorizationOperations('future-oauth')).toThrow(
      ProviderAccountAuthorizationError
    );
  });
});
