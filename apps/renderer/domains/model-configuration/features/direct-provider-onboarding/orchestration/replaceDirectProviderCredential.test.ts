import { describe, expect, it, vi } from 'vitest';

import { replaceDirectProviderCredential } from './replaceDirectProviderCredential';

describe('replaceDirectProviderCredential', () => {
  it('只提交连接身份与去除空白的新 Key', async () => {
    const replaceCredential = vi.fn(async () => undefined);

    await expect(
      replaceDirectProviderCredential('openai-api', '  rotated-secret  ', { replaceCredential })
    ).resolves.toEqual({ ok: true });
    expect(replaceCredential).toHaveBeenCalledWith({
      provider_connection_definition_id: 'openai-api',
      api_key: 'rotated-secret',
    });
  });

  it('空 Key 在本地拒绝，不请求 Host', async () => {
    const replaceCredential = vi.fn(async () => undefined);

    await expect(
      replaceDirectProviderCredential('openai-api', '   ', { replaceCredential })
    ).resolves.toEqual({ ok: false, issue: 'api_key_required' });
    expect(replaceCredential).not.toHaveBeenCalled();
  });
});
