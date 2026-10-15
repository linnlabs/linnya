import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelDiscoveryResponseSchema } from '@app/schemas';
import {
  CustomApiModelRegistrationResponseSchema,
  CustomApiOnboardingErrorResponseSchema,
  CustomApiProviderUpdateResponseSchema,
} from '@app/schemas/custom-api-onboarding';
import {
  CustomApiOnboardingError,
  type CustomApiOnboardingUseCase,
} from 'src/app-hosts/linnya/application/custom-api-onboarding';

import { createCustomApiOnboardingRouter } from './customApiOnboardingRouter';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试未取得 TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('custom API onboarding router', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        server =>
          new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  async function start(useCase: Partial<CustomApiOnboardingUseCase>): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/custom-api-onboarding',
      createCustomApiOnboardingRouter({
        registerModel: vi.fn(),
        updateProvider: vi.fn(),
        ...useCase,
      })
    );
    const server = createServer(app);
    servers.push(server);
    return listen(server);
  }

  it('按 API 格式规范化内网根 URL 后把窄 command 交给 use case', async () => {
    const registerModel = vi.fn(async () => ({ model_id: 'local-model-1' }));
    const baseUrl = await start({ registerModel });
    const response = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_format: 'openai_responses',
        base_url: ' http://models.intranet:8080/ ',
        api_key: 'secret-value',
        endpoint_model_id: 'company-gpt',
        context_window_tokens: 256000,
        max_output_tokens: 16384,
        supports_image_input: true,
      }),
    });

    expect(response.status).toBe(201);
    expect(CustomApiModelRegistrationResponseSchema.parse(await response.json())).toEqual({
      model_id: 'local-model-1',
    });
    expect(registerModel).toHaveBeenCalledWith({
      api_format: 'openai_responses',
      base_url: 'http://models.intranet:8080/v1',
      api_key: 'secret-value',
      provider_name: 'models.intranet',
      models: [
        {
          endpoint_model_id: 'company-gpt',
          context_window_tokens: 256000,
          max_output_tokens: 16384,
          supports_image_input: true,
        },
      ],
    });
  });

  it('拒绝内部 route 与伪造 Provider 字段且不回显密钥', async () => {
    const registerModel = vi.fn();
    const baseUrl = await start({ registerModel });
    const response = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_format: 'openai_compatible',
        base_url: 'https://api.example.com/v1',
        api_key: 'secret-value',
        endpoint_model_id: 'model',
        context_window_tokens: 64000,
        max_output_tokens: 8192,
        supports_image_input: false,
        provider: 'custom',
        route_profile_id: 'openai_compatible_chat',
      }),
    });

    expect(response.status).toBe(400);
    const serialized = JSON.stringify(
      CustomApiOnboardingErrorResponseSchema.parse(await response.json())
    );
    expect(serialized).not.toContain('secret-value');
    expect(registerModel).not.toHaveBeenCalled();
  });

  it('分组编辑按所选格式规范化地址后交给 use case', async () => {
    const updateProvider = vi.fn(async () => ({
      provider_name: 'Relay',
      model_ids: ['local-model-1'],
    }));
    const baseUrl = await start({ updateProvider });
    const response = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/providers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        current_provider_name: 'relay.example.com',
        provider_name: 'Relay',
        api_format: 'anthropic_compatible',
        base_url: 'https://relay.example.com/',
        api_key: 'rotated-secret',
      }),
    });

    expect(response.status).toBe(200);
    expect(CustomApiProviderUpdateResponseSchema.parse(await response.json())).toEqual({
      provider_name: 'Relay',
      model_ids: ['local-model-1'],
    });
    expect(updateProvider).toHaveBeenCalledWith({
      current_provider_name: 'relay.example.com',
      provider_name: 'Relay',
      api_format: 'anthropic_compatible',
      base_url: 'https://relay.example.com/v1',
      api_key: 'rotated-secret',
    });
  });

  it('分组编辑拒绝内部 route 字段，并透传稳定业务错误且不回显密钥', async () => {
    const updateProvider = vi.fn(async () => {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.provider_name_conflict',
        '已存在同名的自定义模型分组',
        409
      );
    });
    const baseUrl = await start({ updateProvider });
    const rejected = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/providers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        current_provider_name: 'Relay',
        provider_name: 'Relay',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        api_key: 'secret-value',
        route_profile_id: 'openai_compatible_chat',
      }),
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain('secret-value');
    expect(updateProvider).not.toHaveBeenCalled();

    const conflict = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/providers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        current_provider_name: 'Relay',
        provider_name: 'Other',
        api_format: 'openai_compatible',
        base_url: 'https://relay.example.com/v1',
        api_key: 'secret-value',
      }),
    });
    expect(conflict.status).toBe(409);
    const failure = CustomApiOnboardingErrorResponseSchema.parse(await conflict.json());
    expect(failure.code).toBe('custom_api_onboarding.provider_name_conflict');
    expect(JSON.stringify(failure)).not.toContain('secret-value');
  });

  it('支持 /discover 端点自动探测模型列表并推断模型能力', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4o' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const app = express();
    app.use(express.json());
    const { ModelDiscoveryService } = await import('src/domains/model-catalog');
    const discoveryService = new ModelDiscoveryService({ fetchFn: mockFetch });
    app.use(
      '/api/v1/custom-api-onboarding',
      createCustomApiOnboardingRouter(
        { registerModel: vi.fn(), updateProvider: vi.fn() },
        discoveryService
      )
    );
    const server = createServer(app);
    servers.push(server);
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/v1/custom-api-onboarding/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_format: 'openai_compatible',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
      }),
    });

    expect(response.status).toBe(200);
    const body = ModelDiscoveryResponseSchema.parse(await response.json());
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      id: 'gpt-4o',
      context_window_tokens: 128000,
      supports_image_input: true,
      confidence: 'inferred',
    });
  });
});
