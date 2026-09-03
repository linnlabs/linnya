/**
 * Serper 搜索基础设施适配器。
 *
 * 负责 HTTP、鉴权与不可信响应解析；工具 Provider 只负责统一业务结果映射。
 */

import { Logger } from '@shared/logger';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';

const logger = new Logger('SerperSearchAdapter');

export interface SerperSearchRequest {
  query: string;
  topK: number;
  language?: string;
}

export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  publishedAt?: string;
}

export interface SerperSearchResult {
  organic: SerperOrganicResult[];
  tookMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseOrganicItem(value: unknown): SerperOrganicResult | null {
  if (!isRecord(value)) return null;
  const link = typeof value['link'] === 'string' ? value['link'].trim() : '';
  if (!link) return null;

  const title = typeof value['title'] === 'string' ? value['title'] : '';
  const snippet = typeof value['snippet'] === 'string' ? value['snippet'] : '';
  const publishedAt = typeof value['date'] === 'string' ? value['date'] : undefined;
  return { title, link, snippet, publishedAt };
}

function parseResponse(value: unknown): SerperOrganicResult[] {
  if (!isRecord(value)) {
    throw new Error('Serper API 响应不是对象。');
  }

  const rawOrganic = value['organic'];
  if (rawOrganic === undefined) return [];
  if (!Array.isArray(rawOrganic)) {
    throw new Error('Serper API 响应的 organic 字段不是数组。');
  }

  return rawOrganic.flatMap((item) => {
    const parsed = parseOrganicItem(item);
    return parsed ? [parsed] : [];
  });
}

export async function serperSearch(args: {
  apiBase: string;
  apiKey: string;
  request: SerperSearchRequest;
  signal?: AbortSignal;
}): Promise<SerperSearchResult> {
  if (!args.apiBase) throw new Error('Serper API 缺少 apiBase。');
  if (!args.apiKey) throw new Error('Serper API 缺少 apiKey。');

  const baseUrl = args.apiBase.endsWith('/') ? args.apiBase : `${args.apiBase}/`;
  const url = new URL('search', baseUrl).toString();
  logger.info('[serperSearch] 发起搜索请求', {
    url,
    topK: args.request.topK,
    hasLanguage: !!args.request.language,
  });

  const body: Record<string, unknown> = {
    q: args.request.query,
    num: args.request.topK,
  };
  if (args.request.language) body['hl'] = args.request.language;

  const response = await webHttpFetch({
    url,
    method: 'POST',
    headers: {
      'X-API-KEY': args.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: args.signal,
    timeoutMs: 30_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });

  if (!response.ok) {
    throw createWebUpstreamHttpError('Serper API', response);
  }

  let json: unknown;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Serper API 响应不是合法 JSON。');
  }
  let organic: SerperOrganicResult[];
  try {
    organic = parseResponse(json);
  } catch (error: unknown) {
    throw new WebHttpError('invalid_response', 'Serper API 响应内容无效。', { cause: error });
  }
  logger.info('[serperSearch] 搜索完成', {
    tookMs: response.tookMs,
    resultCount: organic.length,
  });
  return { organic, tookMs: response.tookMs };
}
