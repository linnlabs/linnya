/**
 * @file src/infra/adapters/web-search/baiduQianfanWebSearchAdapter.ts
 *
 * @description
 * 百度千帆 web_search API 调用适配器。
 *
 * 设计目标：
 * - **高内聚低耦合**：工具层（web_search provider）只关心“搜索结果”，不关心 HTTP/鉴权/响应细节。
 * - **类型严格**：以 unknown 解析响应，通过轻量类型守卫提取字段，禁止 any 断言。
 * - **可观测**：保留 request_id，便于排查上游错误。
 */

import { Logger } from '@shared/logger';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';

const logger = new Logger('BaiduQianfanWebSearchAdapter');

/**
 * 默认屏蔽的低质量/平台聚合站点。
 *
 * 说明：
 * - 该策略属于“产品侧默认约束”，不暴露给模型，也不需要模型提示词去手动指定；
 * - 目前仅屏蔽百家号域名；如需扩展请在此处集中维护，避免散落在工具层。
 */
const DEFAULT_BLOCK_WEBSITES = ['baijiahao.baidu.com'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export type BaiduQianfanSearchEdition = 'standard' | 'lite';
export type BaiduQianfanSearchRecencyFilter = 'week' | 'month' | 'semiyear' | 'year';

export interface BaiduQianfanWebSearchRequest {
  query: string;
  topK: number;
  edition?: BaiduQianfanSearchEdition;
  site?: string;
  recencyFilter?: BaiduQianfanSearchRecencyFilter;
}

export interface BaiduQianfanWebSearchReference {
  id: number;
  type: 'web' | string;
  title: string;
  url: string;
  content: string;
  date?: string;
  webAnchor?: string;
}

export interface BaiduQianfanWebSearchResult {
  requestId?: string;
  references: BaiduQianfanWebSearchReference[];
  tookMs: number;
}

function parseReference(item: unknown): BaiduQianfanWebSearchReference | null {
  if (!isRecord(item)) return null;

  const id = readNumber(item['id']);
  const type = readString(item['type']);
  const title = readString(item['title']);
  const url = readString(item['url']);
  const content = readString(item['content']);

  if (typeof id !== 'number') return null;
  if (typeof type !== 'string') return null;
  if (typeof title !== 'string') return null;
  if (typeof url !== 'string') return null;
  if (typeof content !== 'string') return null;

  const date = readString(item['date']);
  const webAnchor = readString(item['web_anchor']);

  return {
    id,
    type,
    title,
    url,
    content,
    date,
    webAnchor,
  };
}

function parseResponse(json: unknown): Omit<BaiduQianfanWebSearchResult, 'tookMs'> {
  if (!isRecord(json)) {
    throw new Error('百度千帆 web_search 响应不是对象。');
  }

  const requestId = readString(json['request_id']);

  const referencesRaw = json['references'];
  const references: BaiduQianfanWebSearchReference[] = [];

  if (Array.isArray(referencesRaw)) {
    for (const item of referencesRaw) {
      const parsed = parseReference(item);
      if (parsed) references.push(parsed);
    }
  }

  // 上游错误形态：{ code, message, request_id }
  const code = readString(json['code']);
  const message = readString(json['message']);
  if (references.length === 0 && code && message) {
    // 错误对象会被上层作为 cause 保留；供应商自由文本不能借异常链进入诊断。
    throw new Error('百度千帆 web_search 返回业务失败。');
  }

  return { requestId, references };
}

export async function baiduQianfanWebSearch(args: {
  apiBase: string;
  apiKey: string;
  request: BaiduQianfanWebSearchRequest;
  signal?: AbortSignal;
}): Promise<BaiduQianfanWebSearchResult> {
  const { apiBase, apiKey, request, signal } = args;

  if (!apiBase) {
    throw new Error('百度千帆 web_search 缺少 apiBase。');
  }
  if (!apiKey) {
    throw new Error('百度千帆 web_search 缺少 apiKey。');
  }

  // 注意：Model Catalog 会把 `https://qianfan.baidubce.com/v2/ai_search/web_search` 归一化为 `.../v2`
  // 因此这里以 apiBase 作为版本根路径，再拼接固定 endpoint。
  const baseUrl = apiBase.endsWith('/') ? apiBase : `${apiBase}/`;
  const url = new URL('ai_search/web_search', baseUrl).toString();

  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: request.query }],
    search_source: 'baidu_search_v2',
    resource_type_filter: [{ type: 'web', top_k: request.topK }],
  };

  // ✅ 产品侧默认过滤：屏蔽百家号等低权重平台站点
  body['block_websites'] = [...DEFAULT_BLOCK_WEBSITES];

  if (request.edition) {
    body['edition'] = request.edition;
  }

  if (request.site) {
    body['search_filter'] = {
      match: {
        site: [request.site],
      },
    };
  }

  if (request.recencyFilter) {
    body['search_recency_filter'] = request.recencyFilter;
  }

  logger.info('[baiduQianfanWebSearch] 发起搜索请求', {
    url,
    topK: request.topK,
    hasSite: !!request.site,
    recency: request.recencyFilter,
  });

  const response = await webHttpFetch({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 文档示例使用 X-Appbuilder-Authorization（Bearer <AppBuilder API Key>）
      'X-Appbuilder-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
    timeoutMs: 30_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });

  if (!response.ok) {
    throw createWebUpstreamHttpError('百度千帆 web_search', response);
  }

  let json: unknown;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', '百度千帆 web_search 响应不是合法 JSON。');
  }
  let parsed: Omit<BaiduQianfanWebSearchResult, 'tookMs'>;
  try {
    parsed = parseResponse(json);
  } catch (error: unknown) {
    throw new WebHttpError('invalid_response', '百度千帆 web_search 响应内容无效。', { cause: error });
  }

  logger.info('[baiduQianfanWebSearch] 搜索完成', {
    requestId: parsed.requestId,
    referenceCount: parsed.references.length,
    tookMs: response.tookMs,
  });

  return { ...parsed, tookMs: response.tookMs };
}
