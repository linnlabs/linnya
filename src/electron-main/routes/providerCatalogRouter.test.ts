import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProviderCatalogGetResponseSchema,
  ProviderCatalogListResponseSchema,
} from '@app/schemas/provider-catalog';
import { createProviderCatalogRouter } from './providerCatalogRouter';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Provider Catalog router 测试未取得 TCP address。');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('provider catalog router', () => {
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

  async function start(): Promise<string> {
    const app = express();
    app.use('/api/v1/providers', createProviderCatalogRouter());
    const server = createServer(app);
    servers.push(server);
    return listen(server);
  }

  it('从同一公开目录提供 list、search 和 get', async () => {
    const baseUrl = await start();
    const listResponse = await fetch(`${baseUrl}/api/v1/providers`);
    const list = ProviderCatalogListResponseSchema.parse(await listResponse.json());
    expect(listResponse.status).toBe(200);
    expect(list).toEqual(
      expect.objectContaining({
        generation: expect.objectContaining({ source_sha256: expect.any(String) }),
      })
    );
    expect(list.total).toBe(list.providers.length);
    expect(list.total).toBeGreaterThan(0);

    const searchResponse = await fetch(`${baseUrl}/api/v1/providers?q=claude`);
    const search = ProviderCatalogListResponseSchema.parse(await searchResponse.json());
    expect(search.providers.map(provider => provider.id)).toEqual(['anthropic', 'openrouter']);

    const getResponse = await fetch(`${baseUrl}/api/v1/providers/deepseek`);
    const get = ProviderCatalogGetResponseSchema.parse(await getResponse.json());
    expect(get.provider).toEqual(
      expect.objectContaining({
        id: 'deepseek',
        connections: expect.arrayContaining([
          expect.objectContaining({ id: 'deepseek', model_discovery: 'bundled' }),
        ]),
      })
    );
  });

  it('未知 Provider 返回稳定 404，公开响应不泄露 runtime binding', async () => {
    const baseUrl = await start();
    const missing = await fetch(`${baseUrl}/api/v1/providers/not-registered`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      code: 'provider_catalog.provider_not_found',
    });

    const response = await fetch(`${baseUrl}/api/v1/providers/deepseek`);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('package_name');
    expect(serialized).not.toContain('auth_profile');
    expect(serialized).not.toContain('route_profile');
  });
});
