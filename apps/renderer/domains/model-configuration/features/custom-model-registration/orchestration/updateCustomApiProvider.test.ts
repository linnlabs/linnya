import { describe, expect, it, vi } from 'vitest';

import type { CustomApiProviderEditGateway } from '../definitions/customApiProviderEdit';
import { updateCustomApiProvider } from './updateCustomApiProvider';

function gateway(): CustomApiProviderEditGateway & {
  updateProvider: ReturnType<typeof vi.fn>;
} {
  return {
    updateProvider: vi.fn(async () => ({ provider_name: 'Relay', model_ids: ['relay-a'] })),
  };
}

describe('updateCustomApiProvider', () => {
  it('规范化地址，未填写 Key 时不提交凭据字段', async () => {
    const edit = gateway();

    await expect(
      updateCustomApiProvider(
        'relay.example.com',
        {
          providerName: ' Relay ',
          customApiFormat: 'anthropic_compatible',
          baseUrl: ' https://relay.example.com/ ',
          credentialSecret: '   ',
        },
        edit
      )
    ).resolves.toEqual({ ok: true });
    expect(edit.updateProvider).toHaveBeenCalledWith({
      current_provider_name: 'relay.example.com',
      provider_name: 'Relay',
      api_format: 'anthropic_compatible',
      base_url: 'https://relay.example.com/v1',
    });
  });

  it('填写新 Key 时单向提交，输入非法时不请求 Host', async () => {
    const edit = gateway();
    await updateCustomApiProvider(
      'Relay',
      {
        providerName: 'Relay',
        customApiFormat: 'openai_compatible',
        baseUrl: 'https://relay.example.com/v1',
        credentialSecret: ' rotated-secret ',
      },
      edit
    );
    expect(edit.updateProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ api_key: 'rotated-secret' })
    );

    edit.updateProvider.mockClear();
    await expect(
      updateCustomApiProvider(
        'Relay',
        {
          providerName: ' ',
          customApiFormat: 'openai_compatible',
          baseUrl: 'https://relay.example.com/v1',
          credentialSecret: '',
        },
        edit
      )
    ).resolves.toEqual({ ok: false, issue: 'provider_name_required' });
    await expect(
      updateCustomApiProvider(
        'Relay',
        {
          providerName: 'Relay',
          customApiFormat: 'openai_compatible',
          baseUrl: 'ftp://relay.example.com',
          credentialSecret: '',
        },
        edit
      )
    ).resolves.toEqual({ ok: false, issue: 'base_url_invalid' });
    expect(edit.updateProvider).not.toHaveBeenCalled();
  });
});
