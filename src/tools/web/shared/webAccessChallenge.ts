/**
 * 网页访问挑战的唯一判定规则。
 *
 * 优先采用厂商公开文档定义的响应头：AWS WAF 的 `x-amzn-waf-action`（challenge 通常配 202，
 * captcha 通常配 405）与 Cloudflare Challenge Page 的 `cf-mitigated: challenge`。头值本身是判定依据，
 * 状态码只作诊断；不按域名特判，也不把所有 202 当作挑战。正文标记只补充 403/419/429。
 *
 * 判定结果只用于分类、诊断和停止读取，不用于执行、求解或绕过挑战。本模块不依赖其他运行时，
 * 供 Backend HTTP 链路与 Electron 渲染主文档响应共用。
 */

export const WEB_ACCESS_CHALLENGE_SIGNAL_VALUES = [
  'aws_waf_challenge',
  'aws_waf_captcha',
  'cloudflare_challenge',
  'page_marker',
] as const;
export type WebAccessChallengeSignal = (typeof WEB_ACCESS_CHALLENGE_SIGNAL_VALUES)[number];

/** 判定所需的响应头名；渲染路径只回传这些头，不回传完整响应头。 */
export const WEB_ACCESS_CHALLENGE_HEADER_NAMES = ['x-amzn-waf-action', 'cf-mitigated'] as const;
export type WebAccessChallengeHeaderName = (typeof WEB_ACCESS_CHALLENGE_HEADER_NAMES)[number];

export interface WebResponseHeaderLookup {
  get(name: string): string | null | undefined;
}

export function isWebAccessChallengeSignal(value: unknown): value is WebAccessChallengeSignal {
  return WEB_ACCESS_CHALLENGE_SIGNAL_VALUES.some(signal => signal === value);
}

function headerTokens(value: string | null | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(token => token.trim().toLowerCase())
    .filter(token => token.length > 0);
}

/** 只保留判定所需头；跨进程回传前按上限裁剪，不复制完整响应头。 */
export function pickWebAccessChallengeHeaders(
  headers: WebResponseHeaderLookup,
  maxChars: number
): Partial<Record<WebAccessChallengeHeaderName, string>> {
  const picked: Partial<Record<WebAccessChallengeHeaderName, string>> = {};
  for (const name of WEB_ACCESS_CHALLENGE_HEADER_NAMES) {
    const value = headers.get(name);
    if (typeof value === 'string') picked[name] = value.slice(0, maxChars);
  }
  return picked;
}

export function createWebAccessChallengeHeaderLookup(
  headers: Readonly<Partial<Record<WebAccessChallengeHeaderName, string>>>
): WebResponseHeaderLookup {
  return {
    get(name) {
      const known = WEB_ACCESS_CHALLENGE_HEADER_NAMES.find(header => header === name.toLowerCase());
      return known ? headers[known] : undefined;
    },
  };
}

export function detectWebAccessChallengeHeader(
  headers: WebResponseHeaderLookup
): WebAccessChallengeSignal | undefined {
  const awsAction = headerTokens(headers.get('x-amzn-waf-action'));
  if (awsAction.includes('challenge')) return 'aws_waf_challenge';
  if (awsAction.includes('captcha')) return 'aws_waf_captcha';
  // Cloudflare 的 block、dns_filtering 等其他值是站点规则，不属于挑战页。
  if (headerTokens(headers.get('cf-mitigated')).includes('challenge')) return 'cloudflare_challenge';
  return undefined;
}

const CHALLENGE_PAGE_MARKERS = [
  /captcha/i,
  /verify\s+(?:you|that)\s+you(?:'re| are)\s+human/i,
  /human\s+verification/i,
  /access\s+(?:verification|challenge)/i,
  /challenge-platform/i,
  /cloudflare/i,
  /akamai\s+bot/i,
  /huawei\s*cloud\s*waf/i,
  /人机验证|安全验证|访问验证|验证码/,
] as const;

/** 仅凭状态码不足以断定挑战；必须同时出现有限的结构化页面特征。 */
export function isWebChallengeResponse(
  status: number | undefined,
  bodyPreview: string | undefined
): boolean {
  if (status === undefined || bodyPreview === undefined) return false;
  if (status !== 403 && status !== 419 && status !== 429) return false;
  return CHALLENGE_PAGE_MARKERS.some(marker => marker.test(bodyPreview));
}

export function detectWebAccessChallenge(response: {
  readonly status?: number;
  readonly headers?: WebResponseHeaderLookup;
  readonly bodyPreview?: string;
}): WebAccessChallengeSignal | undefined {
  const headerSignal = response.headers ? detectWebAccessChallengeHeader(response.headers) : undefined;
  if (headerSignal) return headerSignal;
  return isWebChallengeResponse(response.status, response.bodyPreview) ? 'page_marker' : undefined;
}
