import {
  localHttpFetch,
  type LocalHttpFetchOptions,
  type LocalHttpFetchResult,
} from '../web-fetch/localHttpFetchAdapter';
import { WebHttpError } from '../web-http/webHttpFetch';
import { assertAllowedWebUrl } from '../../../tools/web/shared/urlPolicy';

export interface SearXNGSearchItem {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
}

export interface SearXNGSearchResult {
  items: SearXNGSearchItem[];
  tookMs: number;
}

export interface SearXNGSearchDependencies {
  fetchPage?: (url: string, options: LocalHttpFetchOptions) => Promise<LocalHttpFetchResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTimeRange(recencyDays: number | undefined): string | undefined {
  if (!recencyDays) return undefined;
  if (recencyDays <= 1) return 'day';
  if (recencyDays <= 7) return 'week';
  if (recencyDays <= 31) return 'month';
  return 'year';
}

function parseSearXNGResponse(value: unknown): SearXNGSearchItem[] {
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    throw new WebHttpError('invalid_response', 'SearXNG 响应缺少 results 数组。');
  }
  return value['results'].flatMap((item): SearXNGSearchItem[] => {
    if (!isRecord(item)) return [];
    const url = typeof item['url'] === 'string' ? item['url'].trim() : '';
    const title = typeof item['title'] === 'string' ? item['title'].trim() : '';
    const snippet = typeof item['content'] === 'string' ? item['content'].trim() : '';
    if (!url || !title) return [];
    const publishedAt = typeof item['publishedDate'] === 'string' ? item['publishedDate'] : undefined;
    const score = typeof item['score'] === 'number' && Number.isFinite(item['score']) ? item['score'] : undefined;
    return [{
      url,
      title,
      snippet,
      ...(publishedAt ? { publishedAt } : {}),
      ...(score !== undefined ? { score } : {}),
    }];
  });
}

export async function searxngSearch(args: {
  apiBase: string;
  query: string;
  language?: string;
  recencyDays?: number;
  signal?: AbortSignal;
}, dependencies: SearXNGSearchDependencies = {}): Promise<SearXNGSearchResult> {
  const baseUrl = assertAllowedWebUrl(args.apiBase);
  const url = new URL('search', baseUrl.toString().endsWith('/') ? baseUrl : `${baseUrl.toString()}/`);
  url.searchParams.set('q', args.query);
  url.searchParams.set('format', 'json');
  if (args.language) url.searchParams.set('language', args.language);
  const timeRange = readTimeRange(args.recencyDays);
  if (timeRange) url.searchParams.set('time_range', timeRange);

  const response = await (dependencies.fetchPage ?? localHttpFetch)(url.toString(), {
    signal: args.signal,
    timeoutMs: 20_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'SearXNG 响应不是合法 JSON。');
  }
  return { items: parseSearXNGResponse(parsed), tookMs: response.tookMs };
}
