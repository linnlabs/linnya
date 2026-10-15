import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectProviderConnectionOnboardingResponseSchema,
  ProviderOnboardingErrorResponseSchema,
} from '@app/schemas/provider-onboarding';
import {
  ProviderOnboardingError,
  type ProviderOnboardingUseCase,
} from 'src/app-hosts/linnya/application/provider-onboarding';

import { createProviderOnboardingRouter } from './providerOnboardingRouter';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试未取得 TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('provider onboarding router', () => {
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

  async function start(
    useCase: Partial<
      Pick<ProviderOnboardingUseCase, 'configureDirectProvider' | 'replaceDirectProviderCredential'>
    >
  ): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1/provider-onboarding',
      createProviderOnboardingRouter({
        configureDirectProvider: vi.fn(),
        replaceDirectProviderCredential: vi.fn(),
        ...useCase,
      })
    );
    const server = createServer(app);
    servers.push(server);
    return listen(server);
  }

  it('只把 Provider 与 Key command 交给 use case', async () => {
    const configureDirectProvider = vi.fn(async () => ({
      model_ids: ['local-model-1'],
      provider_definition_id: 'openai',
      provider_connection_definition_id: 'openai-api',
    }));
    const baseUrl = await start({ configureDirectProvider });
    const response = await fetch(`${baseUrl}/api/v1/provider-onboarding/direct-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider_connection_definition_id: 'openai-api',
        api_key: 'secret-value',
      }),
    });

    expect(response.status).toBe(201);
    const result = DirectProviderConnectionOnboardingResponseSchema.parse(await response.json());
    expect(result.model_ids).toEqual(['local-model-1']);
    expect(configureDirectProvider).toHaveBeenCalledWith({
      provider_connection_definition_id: 'openai-api',
      api_key: 'secret-value',
    });
  });

  it('未知字段被严格 command schema 拒绝且响应不回显密钥', async () => {
    const configureDirectProvider = vi.fn();
    const baseUrl = await start({ configureDirectProvider });
    const response = await fetch(`${baseUrl}/api/v1/provider-onboarding/direct-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider_connection_definition_id: 'openai-api',
        api_key: 'secret-value',
        base_url: 'https://should-not-be-accepted.example',
      }),
    });

    expect(response.status).toBe(400);
    const serialized = JSON.stringify(
      ProviderOnboardingErrorResponseSchema.parse(await response.json())
    );
    expect(serialized).not.toContain('secret-value');
    expect(configureDirectProvider).not.toHaveBeenCalled();
  });

  it('更换 Key 只把连接身份与新 Key 交给 use case', async () => {
    const replaceDirectProviderCredential = vi.fn(async () => undefined);
    const baseUrl = await start({ replaceDirectProviderCredential });
    const response = await fetch(
      `${baseUrl}/api/v1/provider-onboarding/direct-providers/credential`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider_connection_definition_id: 'openai-api',
          api_key: 'rotated-secret',
        }),
      }
    );

    expect(response.status).toBe(204);
    expect(replaceDirectProviderCredential).toHaveBeenCalledWith({
      provider_connection_definition_id: 'openai-api',
      api_key: 'rotated-secret',
    });
  });

  it('更换 Key 拒绝 URL 等额外字段，并透传稳定业务错误且不回显密钥', async () => {
    const replaceDirectProviderCredential = vi.fn(async () => {
      throw new ProviderOnboardingError(
        'provider_onboarding.provider_not_supported',
        '该 Provider 不使用 API Key，无法更换密钥',
        400
      );
    });
    const baseUrl = await start({ replaceDirectProviderCredential });
    const url = `${baseUrl}/api/v1/provider-onboarding/direct-providers/credential`;
    const rejected = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider_connection_definition_id: 'openai-api',
        api_key: 'secret-value',
        base_url: 'https://should-not-be-accepted.example',
      }),
    });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain('secret-value');
    expect(replaceDirectProviderCredential).not.toHaveBeenCalled();

    const unsupported = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider_connection_definition_id: 'chatgpt-account',
        api_key: 'secret-value',
      }),
    });
    expect(unsupported.status).toBe(400);
    const failure = ProviderOnboardingErrorResponseSchema.parse(await unsupported.json());
    expect(failure.code).toBe('provider_onboarding.provider_not_supported');
    expect(JSON.stringify(failure)).not.toContain('secret-value');
  });
});
