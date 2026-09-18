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

export function normalizeCitationWebUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}
