import { Logger } from '@shared/logger';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';

const logger = new Logger('TavilySearchAdapter');

export interface TavilySearchItem {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResult {
  items: TavilySearchItem[];
  tookMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): TavilySearchItem | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value['url'] === 'string' ? value['url'].trim() : '';
  if (!url) return undefined;
  const score = typeof value['score'] === 'number' && Number.isFinite(value['score'])
    ? value['score']
    : undefined;
  return {
    title: typeof value['title'] === 'string' ? value['title'].trim() : '',
    url,
    content: typeof value['content'] === 'string' ? value['content'].trim() : '',
    ...(score !== undefined ? { score } : {}),
  };
}

function parseResponse(value: unknown): TavilySearchItem[] {
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    throw new WebHttpError('invalid_response', 'Tavily Search API 响应缺少 results 数组。');
  }
  return value['results'].flatMap((item) => {
    const parsed = parseItem(item);
    return parsed ? [parsed] : [];
  });
}

export async function tavilySearch(args: {
  apiBase: string;
  apiKey: string;
  query: string;
  topK: number;
  site?: string;
  /** `days` 只对 news 主题生效；通用搜索用 time_range。 */
  timeRange?: 'day' | 'week' | 'month' | 'year';
  signal?: AbortSignal;
}): Promise<TavilySearchResult> {
  if (!args.apiBase) throw new Error('Tavily Search API 缺少 apiBase。');
  if (!args.apiKey) throw new Error('Tavily Search API 缺少 apiKey。');
  const baseUrl = args.apiBase.endsWith('/') ? args.apiBase : `${args.apiBase}/`;
  const url = new URL('search', baseUrl).toString();
  const body: Record<string, unknown> = {
    query: args.query,
    max_results: Math.min(args.topK, 20),
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
  if (args.site) body['include_domains'] = [args.site];
  if (args.timeRange) body['time_range'] = args.timeRange;

  logger.info('[tavilySearch] 发起搜索请求', {
    endpoint: new URL(url).origin,
    topK: args.topK,
    hasSite: !!args.site,
    timeRange: args.timeRange,
  });
  const response = await webHttpFetch({
    url,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: args.signal,
    timeoutMs: 30_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });
  if (!response.ok) throw createWebUpstreamHttpError('Tavily Search API', response);

  let json: unknown;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Tavily Search API 响应不是合法 JSON。');
  }
  const items = parseResponse(json);
  logger.info('[tavilySearch] 搜索完成', { resultCount: items.length, tookMs: response.tookMs });
  return { items, tookMs: response.tookMs };
}
