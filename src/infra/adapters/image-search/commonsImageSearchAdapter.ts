import { isRecord } from '@linnya/foundation';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';
import { IMAGE_SEARCH_USER_AGENT } from './imageSearchHttp';

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
/** Wikimedia 只为一组标准宽度生成缩略图；1920 在其中，足够放满一页幻灯片。 */
export const COMMONS_DOWNLOAD_WIDTH = 1920;

const METADATA_FIELDS = [
  'LicenseShortName', 'LicenseUrl', 'AttributionRequired', 'Artist', 'Credit',
  'ImageDescription', 'ObjectName', 'UsageTerms',
] as const;

/** Commons API 的一条文件结果；extmetadata 的值是 HTML 片段，由领域层清理。 */
export interface CommonsImageItem {
  readonly title: string;
  readonly pageUrl: string;
  readonly imageUrl: string;
  readonly thumbUrl?: string;
  readonly thumbWidth?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mime?: string;
  readonly metadata: Readonly<Partial<Record<(typeof METADATA_FIELDS)[number], string>>>;
}

export interface CommonsImageSearchDependencies {
  httpFetch?: typeof webHttpFetch;
}

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

function parsePage(page: unknown): (CommonsImageItem & { index: number }) | undefined {
  if (!isRecord(page)) return undefined;
  const info = Array.isArray(page['imageinfo']) ? page['imageinfo'][0] : undefined;
  const title = readString(page['title']);
  if (!isRecord(info) || !title) return undefined;
  const imageUrl = readString(info['url']);
  const pageUrl = readString(info['descriptionurl']);
  if (!imageUrl || !pageUrl) return undefined;
  const extmetadata = isRecord(info['extmetadata']) ? info['extmetadata'] : {};
  const metadata: Partial<Record<(typeof METADATA_FIELDS)[number], string>> = {};
  for (const field of METADATA_FIELDS) {
    const entry = extmetadata[field];
    const value = isRecord(entry) ? readString(entry['value']) : undefined;
    if (value) metadata[field] = value;
  }
  const thumbUrl = readString(info['thumburl']);
  const thumbWidth = readNumber(info['thumbwidth']);
  const width = readNumber(info['width']);
  const height = readNumber(info['height']);
  const mime = readString(info['mime']);
  return {
    index: typeof page['index'] === 'number' ? page['index'] : Number.MAX_SAFE_INTEGER,
    title,
    pageUrl,
    imageUrl,
    ...(thumbUrl ? { thumbUrl } : {}),
    ...(thumbWidth ? { thumbWidth } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(mime ? { mime } : {}),
    metadata,
  };
}

/**
 * 用 MediaWiki 搜索（CirrusSearch）在文件命名空间里找位图，一次请求带回尺寸、地址与许可元数据。
 * 不需要 key；按 Wikimedia User-Agent 政策带产品标识。
 */
export async function searchCommonsImages(args: {
  query: string;
  limit: number;
  signal?: AbortSignal;
}, dependencies: CommonsImageSearchDependencies = {}): Promise<{ items: CommonsImageItem[]; tookMs: number }> {
  const url = new URL(COMMONS_API_URL);
  for (const [key, value] of Object.entries({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${args.query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(args.limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(COMMONS_DOWNLOAD_WIDTH),
    iiextmetadatafilter: METADATA_FIELDS.join('|'),
  })) url.searchParams.set(key, value);

  const response = await (dependencies.httpFetch ?? webHttpFetch)({
    url,
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': IMAGE_SEARCH_USER_AGENT },
    signal: args.signal,
    timeoutMs: 20_000,
    maxBodyBytes: 4 * 1024 * 1024,
  });
  if (!response.ok) throw createWebUpstreamHttpError('Wikimedia Commons', response);
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    throw new WebHttpError('invalid_response', 'Wikimedia Commons 返回的不是 JSON。');
  }
  if (!isRecord(body)) throw new WebHttpError('invalid_response', 'Wikimedia Commons 返回结构无效。');
  if (isRecord(body['error'])) throw new WebHttpError('invalid_response', 'Wikimedia Commons 返回了 API 错误。');
  const query = isRecord(body['query']) ? body['query'] : undefined;
  const pages = query && Array.isArray(query['pages']) ? query['pages'] : [];
  const items = pages
    .map(parsePage)
    .filter((item): item is CommonsImageItem & { index: number } => item !== undefined)
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...item }) => item);
  return { items, tookMs: response.tookMs };
}
