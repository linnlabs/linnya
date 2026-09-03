import {
  createWebUpstreamHttpError,
  webHttpFetch,
  WebHttpError,
  type WebHttpResponse,
} from '../web-http/webHttpFetch';
import { createServerSentEventFrameParser } from 'linnkit/contracts';

const PARALLEL_MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';

export interface ParallelFreeSearchItem {
  url: string;
  title: string;
  excerpts: string[];
  publishedAt?: string;
}

export interface ParallelFreeSearchResult {
  items: ParallelFreeSearchItem[];
  tookMs: number;
}

export interface ParallelFreeSearchDependencies {
  httpFetch?: typeof webHttpFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readJsonRpcMessages(bodyText: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return isRecord(parsed) ? [parsed] : [];
  } catch {
    // Streamable HTTP 也允许以 SSE 返回；完整响应体已由 webHttpFetch 统一读取并限长。
  }

  const frameParser = createServerSentEventFrameParser();
  const frames = [
    ...frameParser.feed(new TextEncoder().encode(bodyText)),
    ...frameParser.finish(),
  ];
  const messages: Record<string, unknown>[] = [];
  for (const frame of frames) {
    const data = frame.data.trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (isRecord(parsed)) messages.push(parsed);
    } catch {
      throw new WebHttpError('invalid_response', 'Parallel Free MCP 返回了无效的 SSE JSON 数据。');
    }
  }
  return messages;
}

function readJsonRpcResult(response: WebHttpResponse, id: number): Record<string, unknown> {
  const message = readJsonRpcMessages(response.bodyText).find((candidate) => candidate['id'] === id);
  if (!message) {
    throw new WebHttpError('invalid_response', `Parallel Free MCP 响应缺少请求 id=${id}。`);
  }
  if (isRecord(message['error'])) {
    const error = message['error'];
    const code = typeof error['code'] === 'number' ? ` code=${error['code']}` : '';
    const detail = typeof error['message'] === 'string' ? ` ${error['message']}` : '';
    throw new WebHttpError('invalid_response', `Parallel Free MCP 调用失败:${code}${detail}`.trim());
  }
  if (!isRecord(message['result'])) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP 响应缺少 result。');
  }
  return message['result'];
}

function parseSearchPayload(result: Record<string, unknown>): ParallelFreeSearchItem[] {
  if (result['isError'] === true) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP web_search 返回工具错误。');
  }
  const content = result['content'];
  if (!Array.isArray(content)) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP web_search 缺少 content。');
  }
  const textItem = content.find((item) => isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string');
  if (!isRecord(textItem) || typeof textItem['text'] !== 'string') {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP web_search 缺少文本结果。');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(textItem['text']);
  } catch {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP web_search 文本不是合法 JSON。');
  }
  if (!isRecord(payload) || !Array.isArray(payload['results'])) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP web_search 结果结构无效。');
  }

  return payload['results'].flatMap((item): ParallelFreeSearchItem[] => {
    if (!isRecord(item)) return [];
    const url = typeof item['url'] === 'string' ? item['url'].trim() : '';
    const title = typeof item['title'] === 'string' ? item['title'].trim() : '';
    const excerpts = Array.isArray(item['excerpts'])
      ? item['excerpts'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (!url || !title) return [];
    const publishedAt = typeof item['publish_date'] === 'string' ? item['publish_date'] : undefined;
    return [{ url, title, excerpts, ...(publishedAt ? { publishedAt } : {}) }];
  });
}

async function postMcp(args: {
  url: string;
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
  signal?: AbortSignal;
  maxBodyBytes: number;
  httpFetch: typeof webHttpFetch;
}): Promise<WebHttpResponse> {
  const response = await args.httpFetch({
    url: args.url,
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PARALLEL_MCP_PROTOCOL_VERSION,
      ...(args.sessionId ? { 'Mcp-Session-Id': args.sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: args.id,
      method: args.method,
      params: args.params,
    }),
    signal: args.signal,
    timeoutMs: 30_000,
    maxBodyBytes: args.maxBodyBytes,
  });
  if (!response.ok) throw createWebUpstreamHttpError('Parallel Free MCP', response);
  return response;
}

export async function parallelFreeSearch(args: {
  query: string;
  searchQuery: string;
  apiBase?: string;
  signal?: AbortSignal;
}, dependencies: ParallelFreeSearchDependencies = {}): Promise<ParallelFreeSearchResult> {
  const httpFetch = dependencies.httpFetch ?? webHttpFetch;
  const url = args.apiBase?.trim() || DEFAULT_PARALLEL_MCP_URL;
  const startedAt = Date.now();

  const initializeResponse = await postMcp({
    url,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PARALLEL_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'linnya', version: '1' },
    },
    signal: args.signal,
    maxBodyBytes: 512 * 1024,
    httpFetch,
  });
  const initializeResult = readJsonRpcResult(initializeResponse, 1);
  if (initializeResult['protocolVersion'] !== PARALLEL_MCP_PROTOCOL_VERSION) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP 协议版本不匹配。');
  }
  const sessionId = initializeResponse.headers.get('mcp-session-id')?.trim();
  if (!sessionId) {
    throw new WebHttpError('invalid_response', 'Parallel Free MCP initialize 未返回 Mcp-Session-Id。');
  }

  const callResponse = await postMcp({
    url,
    id: 2,
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: {
        objective: args.query,
        search_queries: [args.searchQuery],
      },
    },
    sessionId,
    signal: args.signal,
    maxBodyBytes: 4 * 1024 * 1024,
    httpFetch,
  });
  return {
    items: parseSearchPayload(readJsonRpcResult(callResponse, 2)),
    tookMs: Date.now() - startedAt,
  };
}
