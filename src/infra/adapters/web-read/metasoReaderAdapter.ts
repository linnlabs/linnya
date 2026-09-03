/**
 * @file src/infra/adapters/web-read/metasoReaderAdapter.ts
 *
 * @description
 * 秘塔（Metaso）Reader API 调用适配器。
 *
 * 设计目标：
 * - 高内聚低耦合：provider 层只关心"返回正文"，不关心 HTTP/鉴权/响应格式。
 * - 类型严格：响应为 text/plain，不做 JSON 解析；标题从正文首行 markdown heading 提取。
 * - 可观测：打印请求/响应关键指标。
 *
 * 接口形态（来自秘塔官方示例）：
 * - POST https://metaso.cn/api/v1/reader
 * - Authorization: Bearer <API_KEY>
 * - Accept: text/plain
 * - Body: { "url": "..." }
 * - Response: 纯文本（markdown 格式的网页正文）
 */

import { Logger } from '@shared/logger';
import { createWebUpstreamHttpError, webHttpFetch } from '../web-http/webHttpFetch';

const logger = new Logger('MetasoReaderAdapter');

export interface MetasoReaderRequest {
  url: string;
}

export interface MetasoReaderResult {
  /** 网页正文（markdown 格式） */
  content: string;
  /** 从正文首行 heading 提取的标题（若无则为空字符串） */
  title: string;
  /** 正文字符数 */
  charCount: number;
  /** HTTP 请求耗时 */
  tookMs: number;
}

/**
 * 构建秘塔 Reader endpoint。
 *
 * 根因说明：
 * - Web Read 服务目录只声明版本根路径，不属于模型目录或模型 Provider；
 * - adapter 在该服务地址上拼接固定 endpoint `reader`。
 */
function buildMetasoReaderEndpoint(apiBase: string): string {
  const trimmed = apiBase.trim().replace(/\/+$/, '');
  let baseUrl: URL;
  try {
    baseUrl = new URL(trimmed);
  } catch (_e) {
    throw new Error(`秘塔 Reader API apiBase 不是合法 URL: "${apiBase}"`);
  }

  // 约束：必须是 Web Read 服务目录声明的版本根路径。
  const normalizedPath = baseUrl.pathname.replace(/\/+$/, '').toLowerCase();
  if (!normalizedPath.endsWith('/api/v1')) {
    throw new Error(
      `秘塔 Reader API apiBase 必须为版本根路径（例如 "https://metaso.cn/api/v1"），当前: "${apiBase}"`
    );
  }

  const base = baseUrl.toString().replace(/\/+$/, '') + '/';
  return new URL('reader', base).toString().replace(/\/+$/, '');
}

/**
 * 从 markdown 正文首行提取 heading 作为标题。
 * 支持 `# Title` / `## Title` 等形式。
 */
function extractTitleFromMarkdown(md: string): string {
  const firstLine = md.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return '';

  const match = /^#{1,6}\s+(.+)/.exec(firstLine.trim());
  return match ? match[1].trim() : '';
}

export async function metasoReaderFetch(args: {
  apiBase: string;
  apiKey: string;
  request: MetasoReaderRequest;
  signal?: AbortSignal;
}): Promise<MetasoReaderResult> {
  const { apiBase, apiKey, request, signal } = args;

  if (!apiBase) {
    throw new Error('秘塔 Reader API 缺少 apiBase。');
  }
  if (!apiKey) {
    throw new Error('秘塔 Reader API 缺少 apiKey。');
  }
  if (!request.url || typeof request.url !== 'string') {
    throw new Error('秘塔 Reader API 缺少有效的 url 参数。');
  }

  // 约定：apiBase 为版本根路径（推荐：https://metaso.cn/api/v1）
  const url = buildMetasoReaderEndpoint(apiBase);

  logger.info('[metasoReaderFetch] 发起请求', {
    url,
    targetRoute: (() => {
      try {
        return new URL(request.url).origin;
      } catch {
        return 'invalid_url';
      }
    })(),
  });

  const response = await webHttpFetch({
    url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/plain',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: request.url }),
    signal,
    timeoutMs: 60_000,
    maxBodyBytes: 10 * 1024 * 1024,
  });

  if (!response.ok) {
    throw createWebUpstreamHttpError('秘塔 Reader API', response);
  }

  const content = response.bodyText;
  const title = extractTitleFromMarkdown(content);

  logger.info('[metasoReaderFetch] 请求完成', {
    charCount: content.length,
    hasTitle: title.length > 0,
    tookMs: response.tookMs,
  });

  return {
    content,
    title,
    charCount: content.length,
    tookMs: response.tookMs,
  };
}
