import { load } from 'cheerio';
import { createWebUpstreamHttpError, webHttpFetch, WebHttpError } from '../web-http/webHttpFetch';

const DEFAULT_DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';

export interface DuckDuckGoSearchItem {
  url: string;
  title: string;
  snippet: string;
}

export interface DuckDuckGoSearchResult {
  items: DuckDuckGoSearchItem[];
  tookMs: number;
}

export interface DuckDuckGoSearchDependencies {
  httpFetch?: typeof webHttpFetch;
}

function readRegion(language: string | undefined): string {
  if (language?.toLowerCase().startsWith('zh')) return 'cn-zh';
  if (language?.toLowerCase().startsWith('en')) return 'us-en';
  return 'wt-wt';
}

function readFreshness(recencyDays: number | undefined): string | undefined {
  if (!recencyDays) return undefined;
  if (recencyDays <= 1) return 'd';
  if (recencyDays <= 7) return 'w';
  if (recencyDays <= 31) return 'm';
  return 'y';
}

function readTargetUrl(href: string): string | undefined {
  if (!href.trim()) return undefined;
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const redirected = url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/'
      ? url.searchParams.get('uddg')
      : undefined;
    const target = redirected ? new URL(redirected) : url;
    return target.protocol === 'http:' || target.protocol === 'https:' ? target.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseDuckDuckGoHtml(html: string): DuckDuckGoSearchItem[] {
  const $ = load(html);
  const challenged = $('#challenge-form, .anomaly-modal, [data-testid="anomaly-modal"]').length > 0
    || /complete the following challenge|unusual traffic|bots use duckduckgo/i.test($.root().text());
  if (challenged) {
    throw new WebHttpError('invalid_response', 'DuckDuckGo 返回了机器人挑战页。');
  }

  const items: DuckDuckGoSearchItem[] = [];
  $('.result').each((_index, element) => {
    const link = $(element).find('a.result__a').first();
    const url = readTargetUrl(link.attr('href') ?? '');
    const title = link.text().replace(/\s+/g, ' ').trim();
    const snippet = $(element).find('.result__snippet').first().text().replace(/\s+/g, ' ').trim();
    if (url && title) items.push({ url, title, snippet });
  });
  if (items.length === 0) {
    throw new WebHttpError(
      'invalid_response',
      'DuckDuckGo 未返回可解析结果，可能被限流或页面结构已经变化。',
    );
  }
  return items;
}

export async function duckDuckGoSearch(args: {
  query: string;
  language?: string;
  recencyDays?: number;
  apiBase?: string;
  signal?: AbortSignal;
}, dependencies: DuckDuckGoSearchDependencies = {}): Promise<DuckDuckGoSearchResult> {
  const url = new URL(args.apiBase?.trim() || DEFAULT_DUCKDUCKGO_HTML_URL);
  url.searchParams.set('q', args.query);
  url.searchParams.set('kl', readRegion(args.language));
  const freshness = readFreshness(args.recencyDays);
  if (freshness) url.searchParams.set('df', freshness);

  const response = await (dependencies.httpFetch ?? webHttpFetch)({
    url,
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; Linnya/1.0; +https://linnyai.com)',
    },
    signal: args.signal,
    timeoutMs: 20_000,
    maxBodyBytes: 2 * 1024 * 1024,
  });
  if (!response.ok) throw createWebUpstreamHttpError('DuckDuckGo HTML Search', response);
  return { items: parseDuckDuckGoHtml(response.bodyText), tookMs: response.tookMs };
}
