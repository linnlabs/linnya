import { Logger } from '@shared/logger';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';

const logger = new Logger('JinaSearchAdapter');
const DEFAULT_JINA_SEARCH_URL = 'https://s.jina.ai/';

export interface JinaSearchItem {
  title: string;
  url: string;
  description: string;
  content: string;
}

export interface JinaSearchResult {
  items: JinaSearchItem[];
  tookMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): JinaSearchItem | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value['url'] === 'string' ? value['url'].trim() : '';
  if (!url) return undefined;
  return {
    title: typeof value['title'] === 'string' ? value['title'].trim() : '',
    url,
    description: typeof value['description'] === 'string' ? value['description'].trim() : '',
    content: typeof value['content'] === 'string' ? value['content'].trim() : '',
  };
}

function parseResponse(value: unknown): JinaSearchItem[] {
  if (!isRecord(value) || !Array.isArray(value['data'])) {
    throw new WebHttpError('invalid_response', 'Jina Search API 响应缺少 data 数组。');
  }
  return value['data'].flatMap((item) => {
    const parsed = parseItem(item);
    return parsed ? [parsed] : [];
  });
}

export async function jinaSearch(args: {
  apiBase?: string;
  apiKey: string;
  query: string;
  signal?: AbortSignal;
}): Promise<JinaSearchResult> {
  if (!args.apiKey) throw new Error('Jina Search API 缺少 apiKey。');
  const url = new URL(args.apiBase?.trim() || DEFAULT_JINA_SEARCH_URL);
  url.searchParams.set('q', args.query);

  logger.info('[jinaSearch] 发起搜索请求', { endpoint: url.origin, queryLength: args.query.length });
  const response = await webHttpFetch({
    url: url.toString(),
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    signal: args.signal,
    timeoutMs: 30_000,
    maxBodyBytes: 4 * 1024 * 1024,
  });
  if (!response.ok) throw createWebUpstreamHttpError('Jina Search API', response);

  let json: unknown;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Jina Search API 响应不是合法 JSON。');
  }
  const items = parseResponse(json);
  logger.info('[jinaSearch] 搜索完成', { resultCount: items.length, tookMs: response.tookMs });
  return { items, tookMs: response.tookMs };
}
