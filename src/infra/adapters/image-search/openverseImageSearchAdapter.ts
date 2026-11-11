import { isRecord } from '@linnya/foundation';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';
import { IMAGE_SEARCH_USER_AGENT } from './imageSearchHttp';

const OPENVERSE_IMAGES_URL = 'https://api.openverse.org/v1/images/';
/** 匿名请求每页最多 20 条。 */
export const OPENVERSE_MAX_PAGE_SIZE = 20;

/** Openverse 的一条图片结果。许可代码与署名文字由 Openverse 按 CC 目录给出。 */
export interface OpenverseImageItem {
  readonly id: string;
  readonly title?: string;
  readonly imageUrl: string;
  readonly pageUrl: string;
  readonly width?: number;
  readonly height?: number;
  readonly filetype?: string;
  readonly license: string;
  readonly licenseVersion?: string;
  readonly licenseUrl?: string;
  readonly creator?: string;
  readonly provider?: string;
  readonly source?: string;
  readonly attribution?: string;
}

export interface OpenverseImageSearchDependencies {
  httpFetch?: typeof webHttpFetch;
}

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

function parseResult(value: unknown): OpenverseImageItem | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value['id']);
  const imageUrl = readString(value['url']);
  const pageUrl = readString(value['foreign_landing_url']);
  const license = readString(value['license']);
  if (!id || !imageUrl || !pageUrl || !license) return undefined;
  const optional = {
    title: readString(value['title']),
    width: readNumber(value['width']),
    height: readNumber(value['height']),
    filetype: readString(value['filetype']),
    licenseVersion: readString(value['license_version']),
    licenseUrl: readString(value['license_url']),
    creator: readString(value['creator']),
    provider: readString(value['provider']),
    source: readString(value['source']),
    attribution: readString(value['attribution']),
  };
  return {
    id, imageUrl, pageUrl, license,
    ...Object.fromEntries(Object.entries(optional).filter(([, entry]) => entry !== undefined)),
  };
}

/**
 * Openverse 图片搜索（匿名，按 IP 每分钟约 20 次、每天约 200 次）。
 * `excludeSources` 用来去掉已由其他来源直接提供的部分（例如 Commons）。
 */
export async function searchOpenverseImages(args: {
  query: string;
  pageSize: number;
  commercialOnly: boolean;
  excludeSources?: readonly string[];
  signal?: AbortSignal;
}, dependencies: OpenverseImageSearchDependencies = {}): Promise<{ items: OpenverseImageItem[]; tookMs: number }> {
  const url = new URL(OPENVERSE_IMAGES_URL);
  url.searchParams.set('q', args.query);
  url.searchParams.set('page_size', String(Math.min(args.pageSize, OPENVERSE_MAX_PAGE_SIZE)));
  url.searchParams.set('mature', 'false');
  if (args.commercialOnly) url.searchParams.set('license_type', 'commercial');
  if (args.excludeSources?.length) url.searchParams.set('excluded_source', args.excludeSources.join(','));

  const response = await (dependencies.httpFetch ?? webHttpFetch)({
    url,
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': IMAGE_SEARCH_USER_AGENT },
    signal: args.signal,
    timeoutMs: 20_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });
  if (!response.ok) throw createWebUpstreamHttpError('Openverse', response);
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Openverse 返回的不是 JSON。');
  }
  if (!isRecord(body) || !Array.isArray(body['results'])) {
    throw new WebHttpError('invalid_response', 'Openverse 返回结构无效。');
  }
  const items = body['results']
    .map(parseResult)
    .filter((item): item is OpenverseImageItem => item !== undefined);
  return { items, tookMs: response.tookMs };
}
