/**
 * GitHub blob 页面包含大量仓库 UI，且超大源码经常无法稳定抽取。
 * Raw 域名返回明确的 text/plain，可直接复用本地抓取的大小、超时与 SSRF 边界。
 */
export function resolveReadableWebUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'github.com'
    || url.port
    || segments.length < 5
    || segments[2] !== 'blob') {
    return rawUrl;
  }

  const raw = new URL('https://raw.githubusercontent.com');
  raw.pathname = `/${segments[0]}/${segments[1]}/${segments.slice(3).join('/')}`;
  return raw.toString();
}
