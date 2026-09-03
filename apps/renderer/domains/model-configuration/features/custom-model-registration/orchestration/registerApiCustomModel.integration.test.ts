import { describe, expect, it, vi } from 'vitest';
import type { CustomApiModelRegistrationCommand } from '@app/schemas/custom-api-onboarding';

import type { CustomApiModelRegistrationGateway } from '../definitions/customApiModelRegistrationGateway';
import { registerApiCustomModel } from './registerApiCustomModel';

function recordingGateway(
  commands: CustomApiModelRegistrationCommand[]
): CustomApiModelRegistrationGateway {
  return {
    register: vi.fn(async command => {
      commands.push(command);
      return { model_id: 'local-model-1' };
    }),
  };
}

describe('registerApiCustomModel', () => {
  it('只提交用户配置事实，允许内网 HTTP，不拼内部 route 或 Provider', async () => {
    const commands: CustomApiModelRegistrationCommand[] = [];
    const result = await registerApiCustomModel(
      {
        endpointModelId: 'company-gpt',
        displayName: '',
        credentialSecret: 'secret-value',
        baseUrl: 'http://models.intranet:8080/v1/',
        customApiFormat: 'openai_responses',
        contextWindowTokens: '256000',
        maxOutputTokens: '16384',
        supportsImageInput: true,
      },
      recordingGateway(commands)
    );

    expect(result).toEqual({ ok: true });
    expect(commands).toEqual([
      {
        api_format: 'openai_responses',
        base_url: 'http://models.intranet:8080/v1',
        api_key: 'secret-value',
        endpoint_model_id: 'company-gpt',
        context_window_tokens: 256000,
        max_output_tokens: 16384,
        supports_image_input: true,
      },
    ]);
    expect(commands[0]).not.toHaveProperty('provider');
    expect(commands[0]).not.toHaveProperty('route_profile_id');
    expect(commands[0]).not.toHaveProperty('auth_profile');
    expect(commands[0]).not.toHaveProperty('capability_id');
  });

  it('允许 Key 留空，由 Host 决定能否复用已有 credential', async () => {
    const commands: CustomApiModelRegistrationCommand[] = [];
    await expect(
      registerApiCustomModel(
        {
          endpointModelId: 'company-gpt',
          displayName: 'Company GPT',
          credentialSecret: '',
          baseUrl: 'https://models.example.com/v1',
          customApiFormat: 'anthropic_compatible',
          contextWindowTokens: '200000',
          maxOutputTokens: '16384',
          supportsImageInput: false,
        },
        recordingGateway(commands)
      )
    ).resolves.toEqual({ ok: true });

    expect(commands[0]).not.toHaveProperty('api_key');
    expect(commands[0]).toMatchObject({ display_name: 'Company GPT' });
  });

  it('允许 OpenAI-compatible 模型声明图片输入语义能力', async () => {
    const commands: CustomApiModelRegistrationCommand[] = [];
    await expect(
      registerApiCustomModel(
        {
          endpointModelId: 'vision-chat',
          displayName: '',
          credentialSecret: 'secret-value',
          baseUrl: 'https://api.example.com/v1',
          customApiFormat: 'openai_compatible',
          contextWindowTokens: '64000',
          maxOutputTokens: '8192',
          supportsImageInput: true,
        },
        recordingGateway(commands)
      )
    ).resolves.toEqual({ ok: true });
    expect(commands[0]).toMatchObject({ supports_image_input: true });
  });

  it('本地字段校验失败时不调用后端', async () => {
    const commands: CustomApiModelRegistrationCommand[] = [];
    const gateway = recordingGateway(commands);
    const baseForm = {
      endpointModelId: 'model',
      displayName: '',
      credentialSecret: 'secret-value',
      baseUrl: 'https://api.example.com/v1',
      customApiFormat: 'openai_compatible' as const,
      contextWindowTokens: '64000',
      maxOutputTokens: '8192',
      supportsImageInput: false,
    };

    await expect(
      registerApiCustomModel({ ...baseForm, endpointModelId: '' }, gateway)
    ).resolves.toEqual({
      ok: false,
      issue: 'endpoint_model_id_required',
    });
    await expect(
      registerApiCustomModel({ ...baseForm, baseUrl: 'models.intranet/v1' }, gateway)
    ).resolves.toEqual({
      ok: false,
      issue: 'base_url_invalid',
    });
    await expect(
      registerApiCustomModel({ ...baseForm, contextWindowTokens: '0' }, gateway)
    ).resolves.toEqual({
      ok: false,
      issue: 'token_limits_invalid',
    });
    expect(commands).toEqual([]);
  });
});
