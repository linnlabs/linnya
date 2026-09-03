/** 页面只能留在用户请求的 hostname；允许同站协议升级和端口变化。 */
export function isAllowedRenderNavigation(targetUrl: string, candidateUrl: string): boolean {
  if (candidateUrl === 'about:blank') return true;
  try {
    const target = new URL(targetUrl);
    const candidate = new URL(candidateUrl);
    return (candidate.protocol === 'http:' || candidate.protocol === 'https:')
      && candidate.hostname.toLowerCase() === target.hostname.toLowerCase();
  } catch {
    return false;
  }
}
