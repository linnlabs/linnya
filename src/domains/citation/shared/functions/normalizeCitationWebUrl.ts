/**
 * 规范化 Web Citation 的稳定 URL。
 *
 * Markdown 作者可以使用带追踪参数或片段的普通链接，但来源接纳必须与 Web producer
 * 使用同一套身份归一规则，才能把链接安全映射到当前 Conversation 已取得的来源快照。
 */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'twclid',
  'mc_cid',
  'mc_eid',
] as const;

/**
 * 规范化 SPA hash 路由片段。
 *
 * 普通页内锚点（`#section`、`#:~:text=...`、`#`）与根路径空壳（`#/`、`#!/`）剥离以复用来源身份；
 * SPA 路由片段（`#/...`、`#!/...`）保留路由路径与功能查询参数，仅去掉末尾多余斜杠、二级子锚点与追踪参数。
 */
function normalizeSpaHashFragment(rawHash: string): string {
  if (!rawHash.startsWith('#/') && !rawHash.startsWith('#!/')) {
    return '';
  }
  const prefix = rawHash.startsWith('#!/') ? '#!' : '#';
  const [routeBeforeSubAnchor = '/'] = rawHash.slice(prefix.length).split('#', 1);
  const queryIndex = routeBeforeSubAnchor.indexOf('?');
  const rawRoutePath = queryIndex >= 0 ? routeBeforeSubAnchor.slice(0, queryIndex) : routeBeforeSubAnchor;
  const rawRouteQuery = queryIndex >= 0 ? routeBeforeSubAnchor.slice(queryIndex + 1) : '';
  const normalizedPath = rawRoutePath.replace(/\/+$/, '') || '/';
  let normalizedQuery = '';
  if (rawRouteQuery) {
    const searchParams = new URLSearchParams(rawRouteQuery);
    for (const param of TRACKING_PARAMS) {
      searchParams.delete(param);
    }
    normalizedQuery = searchParams.toString();
  }
  if (normalizedPath === '/' && !normalizedQuery) {
    return '';
  }
  return `${prefix}${normalizedPath}${normalizedQuery ? `?${normalizedQuery}` : ''}`;
}

export function hasSpaHashRouteUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return normalizeSpaHashFragment(url.hash) !== '';
  } catch {
    return false;
  }
}

export function normalizeCitationWebUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    url.hash = normalizeSpaHashFragment(url.hash);
    return url.toString();
  } catch {
    return rawUrl;
  }
}
