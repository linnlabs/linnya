import { getDomain } from 'tldts';
import { assertAllowedWebUrl } from '../../../tools/web/shared/urlPolicy';

/** 同一注册域内允许跳转；实际网络请求还必须逐次通过 session 的 URL/DNS 准入。 */
export function isAllowedRenderNavigation(targetUrl: string, candidateUrl: string): boolean {
  if (candidateUrl === 'about:blank') return true;
  try {
    const target = assertAllowedWebUrl(targetUrl);
    const candidate = assertAllowedWebUrl(candidateUrl);
    // 纳入私有后缀，避免把 github.io 等不同租户误认作同一网站；IP/localhost 没有注册域。
    const targetDomain = getDomain(target.hostname, { allowPrivateDomains: true });
    const candidateDomain = getDomain(candidate.hostname, { allowPrivateDomains: true });
    return targetDomain !== null && targetDomain === candidateDomain;
  } catch {
    return false;
  }
}

/**
 * 仅用于初次主框架提交前的服务端 HTTP 重定向（如短链、DOI、跨站迁址）。
 * 要求合法 HTTP(S) 且具备公共可解析注册域（拒绝 IP、localhost、凭据与危险协议）；
 * 实际网络请求仍须逐跳通过 session 的 URL/DNS 准入。
 */
export function isAllowedPreCommitRedirectTarget(candidateUrl: string): boolean {
  if (candidateUrl === 'about:blank') return false;
  try {
    const candidate = assertAllowedWebUrl(candidateUrl);
    return getDomain(candidate.hostname, { allowPrivateDomains: true }) !== null;
  } catch {
    return false;
  }
}
