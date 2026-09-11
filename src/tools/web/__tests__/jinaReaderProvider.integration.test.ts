import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WebReadServiceRequest } from '../webread/definitions/webReadService';
import { JinaReaderProvider } from '../webread/providers/jina';
import { WebUpstreamFixtureServer } from './fixtures/webUpstreamFixtureServer';

function createConfig(baseUrl: string): WebReadServiceRequest {
  return {
    serviceId: 'jina_reader',
    baseUrl,
    apiKey: 'fixture-jina-key',
  };
}

describe('JinaReaderProvider 本地真实 HTTP 集成', () => {
  const fixture = new WebUpstreamFixtureServer();

  beforeAll(async () => fixture.start());
  afterAll(async () => fixture.stop());
  afterEach(() => fixture.reset());

  it.each(['direct', 'browser'] as const)('%s engine 透传请求头并解析正文元数据', async (engine) => {
    const provider = new JinaReaderProvider(createConfig(`${fixture.baseUrl}/jina`), { engine });
    const result = await provider.read({ url: 'https://example.com/source' });

    expect(fixture.latestJinaHeaders).toMatchObject({
      authorization: 'Bearer fixture-jina-key',
      accept: 'application/json',
      contentType: 'application/json',
      engine,
      returnFormat: 'markdown',
      timeout: '55',
    });
    expect(fixture.latestJinaRequest).toEqual({ url: 'https://example.com/source' });
    expect(result).toMatchObject({
      title: 'Jina Fixture Article',
      url: 'https://example.com/source',
      finalUrl: 'https://example.com/final-article',
      publishedAt: '2026-07-18T00:00:00Z',
    });
    expect(result.content).toContain('正文包含代码块和表格');
  });

  it.each([
    ['rate_limit', 'rate_limited'],
    ['business_error', 'invalid_response'],
    ['malformed', 'invalid_response'],
    ['missing_content', 'invalid_response'],
  ] as const)('%s 保留稳定失败分类', async (scenario, kind) => {
    fixture.jinaScenario = scenario;
    const provider = new JinaReaderProvider(createConfig(`${fixture.baseUrl}/jina`));
    await expect(provider.read({ url: 'https://example.com/source' })).rejects.toMatchObject({ kind });
  });

  it('调用方取消透传到 Jina HTTP 请求', async () => {
    fixture.jinaScenario = 'delayed';
    const controller = new AbortController();
    const provider = new JinaReaderProvider(createConfig(`${fixture.baseUrl}/jina`));
    const promise = provider.read({ url: 'https://example.com/source', signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('HTTP 200 业务失败不把上游 message/detail 带入异常', async () => {
    fixture.jinaScenario = 'business_error';
    const provider = new JinaReaderProvider(createConfig(`${fixture.baseUrl}/jina`));
    await expect(provider.read({ url: 'https://example.com/source' })).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'Jina Reader 返回业务失败状态 code=422 status=42201。',
      cause: undefined,
    });
  });
});
