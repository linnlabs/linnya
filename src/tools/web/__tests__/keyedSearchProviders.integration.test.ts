import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSearchServiceRequest } from '../websearch/definitions/webSearchService';
import { JinaSearchProvider } from '../websearch/providers/jina';
import { TavilyProvider } from '../websearch/providers/tavily';

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function config(
  serviceId: 'jina_search' | 'tavily',
  baseUrl: string,
): WebSearchServiceRequest {
  return {
    serviceId,
    baseUrl,
    apiKey: `fixture-${serviceId}-key`,
  };
}

describe('Jina Search 与 Tavily BYOK 真实 HTTP 合同', () => {
  let server: Server;
  let origin = '';
  const observed: {
    jinaAuthorization: string;
    jinaQuery: string;
    tavilyAuthorization: string;
    tavilyBody?: Record<string, unknown>;
  } = {
    jinaAuthorization: '',
    jinaQuery: '',
    tavilyAuthorization: '',
  };

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', origin);
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/jina') {
        observed.jinaAuthorization = String(request.headers.authorization ?? '');
        observed.jinaQuery = url.searchParams.get('q') ?? '';
        response.end(JSON.stringify({
          code: 200,
          status: 20_000,
          data: [
            {
              title: 'Jina fixture',
              url: 'https://example.com/jina',
              description: `Jina description ${'dense '.repeat(240)}`,
              content: 'Jina full content',
            },
            {
              title: 'Jina second',
              url: 'https://example.org/jina-second',
              description: 'Second description',
              content: 'Second content',
            },
          ],
        }));
        return;
      }
      if (url.pathname === '/tavily/search') {
        observed.tavilyAuthorization = String(request.headers.authorization ?? '');
        const requestBody: unknown = JSON.parse(await readBody(request));
        if (!isRecord(requestBody)) throw new Error('Tavily fixture 请求体不是对象');
        observed.tavilyBody = requestBody;
        response.end(JSON.stringify({
          results: [{
            title: 'Tavily fixture',
            url: 'https://example.com/tavily',
            content: 'Tavily result content',
            score: 0.91,
          }],
        }));
        return;
      }
      if (url.pathname === '/invalid-jina') {
        response.end(JSON.stringify({ data: {} }));
        return;
      }
      if (url.pathname === '/invalid-tavily/search') {
        response.end(JSON.stringify({ results: {} }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server 未返回端口');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('Jina 发送 Bearer Key、站点查询并限制摘要预算和 topK', async () => {
    const provider = new JinaSearchProvider(config('jina_search', `${origin}/jina`));
    const results = await provider.search({ query: 'Jina query', site: 'example.com', topK: 1 });

    expect(observed.jinaAuthorization).toBe('Bearer fixture-jina_search-key');
    expect(observed.jinaQuery).toBe('site:example.com Jina query');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      provider: 'jina_search',
      title: 'Jina fixture',
      canonicalUrl: 'https://example.com/jina',
    });
    expect(results[0]?.snippet.length).toBe(1_200);
  });

  it('Tavily 发送 Bearer Key，并透传站点、时效和结果预算', async () => {
    const provider = new TavilyProvider(config('tavily', `${origin}/tavily`));
    const results = await provider.search({
      query: 'Tavily query',
      site: 'example.com',
      recencyDays: 7,
      topK: 3,
    });

    expect(observed.tavilyAuthorization).toBe('Bearer fixture-tavily-key');
    expect(observed.tavilyBody).toMatchObject({
      query: 'Tavily query',
      max_results: 3,
      include_domains: ['example.com'],
      days: 7,
      include_raw_content: false,
    });
    expect(results[0]).toMatchObject({
      provider: 'tavily',
      canonicalUrl: 'https://example.com/tavily',
      snippet: 'Tavily result content',
      providerScore: 0.91,
    });
  });

  it('两家响应结构异常时保留统一 invalid_response 失败语义', async () => {
    const jina = new JinaSearchProvider(config('jina_search', `${origin}/invalid-jina`));
    const tavily = new TavilyProvider(config('tavily', `${origin}/invalid-tavily`));
    await expect(jina.search({ query: 'invalid' })).rejects.toMatchObject({ kind: 'invalid_response' });
    await expect(tavily.search({ query: 'invalid' })).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
