import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectProviderConnectionOnboardingResponseSchema,
  ProviderOnboardingErrorResponseSchema,
} from '@app/schemas/provider-onboarding';
import type { ProviderOnboardingUseCase } from 'src/app-hosts/linnya/application/provider-onboarding';

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
    useCase: Pick<ProviderOnboardingUseCase, 'configureDirectProvider'>
  ): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/provider-onboarding', createProviderOnboardingRouter(useCase));
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
});
