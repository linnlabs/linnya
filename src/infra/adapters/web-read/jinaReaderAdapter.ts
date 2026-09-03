/**
 * Jina Reader API 基础设施适配器。
 *
 * 负责 HTTP、鉴权和不可信 JSON 解析。direct/browser 是显式执行参数，adapter
 * 不根据页面或失败文案自行升级，避免形成不可观察的供应商内 fallback。
 */

import { Logger } from '@shared/logger';
import {
  createWebUpstreamHttpError,
  webHttpFetch,
  WebHttpError,
} from '../web-http/webHttpFetch';

const logger = new Logger('JinaReaderAdapter');

export type JinaReaderEngine = 'direct' | 'browser';

export interface JinaReaderRequest {
  url: string;
  engine?: JinaReaderEngine;
}

export interface JinaReaderResult {
  content: string;
  title: string;
  url: string;
  description?: string;
  publishedAt?: string;
  tokenCount?: number;
  charCount: number;
  tookMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readTokenCount(data: Record<string, unknown>): number | undefined {
  const usage = data['usage'];
  if (!isRecord(usage)) return undefined;
  const tokens = usage['tokens'];
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens : undefined;
}

function assertSuccessfulBusinessStatus(value: Record<string, unknown>): void {
  const code = value['code'];
  const status = value['status'];
  const failedCode = typeof code === 'number' && code !== 200;
  const failedStatus = typeof status === 'number' && status !== 20_000;
  if (!failedCode && !failedStatus) return;

  const detail = readTrimmedString(value, 'message') ?? readTrimmedString(value, 'detail');
  throw new WebHttpError(
    'invalid_response',
    `Jina Reader 返回业务失败状态${typeof code === 'number' ? ` code=${code}` : ''}` +
      `${typeof status === 'number' ? ` status=${status}` : ''}${detail ? `: ${detail}` : '。'}`,
  );
}

function parseResponse(value: unknown, requestedUrl: string, tookMs: number): JinaReaderResult {
  if (!isRecord(value)) {
    throw new WebHttpError('invalid_response', 'Jina Reader 响应不是有效对象。');
  }
  // Jina 的 HTTP 状态与 JSON 业务状态是两层合同；业务失败不能继续按成功正文解析。
  assertSuccessfulBusinessStatus(value);
  if (!isRecord(value['data'])) {
    throw new WebHttpError('invalid_response', 'Jina Reader 响应缺少 data 对象。');
  }
  const data = value['data'];
  const content = readTrimmedString(data, 'content');
  if (!content) {
    throw new WebHttpError('invalid_response', 'Jina Reader 响应缺少有效正文 content。');
  }

  const title = readTrimmedString(data, 'title') ?? '';
  const finalUrl = readTrimmedString(data, 'url') ?? requestedUrl;
  const description = readTrimmedString(data, 'description');
  const publishedAt = readTrimmedString(data, 'publishedTime');
  const tokenCount = readTokenCount(data);

  return {
    content,
    title,
    url: finalUrl,
    charCount: content.length,
    tookMs,
    ...(description ? { description } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(tokenCount !== undefined ? { tokenCount } : {}),
  };
}

export async function jinaReaderFetch(args: {
  apiBase: string;
  apiKey: string;
  request: JinaReaderRequest;
  signal?: AbortSignal;
}): Promise<JinaReaderResult> {
  if (!args.apiBase) throw new Error('Jina Reader API 缺少 apiBase。');
  if (!args.apiKey) throw new Error('Jina Reader API 缺少 apiKey。');
  if (!args.request.url) throw new Error('Jina Reader API 缺少目标 url。');

  let endpoint: string;
  try {
    endpoint = new URL(args.apiBase).toString();
  } catch {
    throw new Error(`Jina Reader API apiBase 不是合法 URL: "${args.apiBase}"`);
  }
  const engine = args.request.engine ?? 'direct';
  logger.info('[jinaReaderFetch] 发起请求', {
    provider: 'jina_reader',
    engine,
    endpoint: new URL(endpoint).origin,
    targetRoute: (() => {
      try { return new URL(args.request.url).origin; } catch { return 'invalid_url'; }
    })(),
  });

  const response = await webHttpFetch({
    url: endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Return-Format': 'markdown',
      'X-Engine': engine,
      'X-Timeout': '55',
    },
    body: JSON.stringify({ url: args.request.url }),
    signal: args.signal,
    timeoutMs: 60_000,
    maxBodyBytes: 10 * 1024 * 1024,
  });

  if (!response.ok) throw createWebUpstreamHttpError('Jina Reader API', response);

  let json: unknown;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Jina Reader 响应不是合法 JSON。');
  }
  const result = parseResponse(json, args.request.url, response.tookMs);
  logger.info('[jinaReaderFetch] 请求完成', {
    provider: 'jina_reader',
    engine,
    tookMs: result.tookMs,
    charCount: result.charCount,
    tokenCount: result.tokenCount,
  });
  return result;
}
