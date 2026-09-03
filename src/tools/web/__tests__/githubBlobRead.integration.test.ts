import { describe, expect, it } from 'vitest';
import type { ResolvedWebHost } from '../shared/urlPolicy';
import { resolveReadableWebUrl } from '../webread/functions/resolveReadableWebUrl';
import { LocalHttpProvider } from '../webread/providers/localHttp';

describe('GitHub blob 本地读取', () => {
  it('把 blob 地址转换为 Raw，并移除只属于 GitHub 页面 UI 的 query 与 hash', () => {
    expect(resolveReadableWebUrl(
      'https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md?plain=1#L10',
    )).toBe(
      'https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md',
    );
  });

  it('不改写 GitHub 仓库页、非 GitHub 地址和不完整 blob 地址', () => {
    const urls = [
      'https://github.com/openai/codex',
      'https://example.com/openai/codex/blob/main/README.md?view=1#intro',
      'https://github.com/openai/codex/blob/main',
    ];
    for (const url of urls) expect(resolveReadableWebUrl(url)).toBe(url);
  });

  it('Provider 对转换后的 Raw 域名重新执行安全校验，并保留原始 URL', async () => {
    const resolvedHosts: string[] = [];
    const requestedUrls: string[] = [];
    const content = 'export const linnya = true;\n'.repeat(20);
    const bodyData = new TextEncoder().encode(content);
    const resolveHost = async (url: URL): Promise<ResolvedWebHost> => {
      resolvedHosts.push(url.hostname);
      return {
        hostname: url.hostname,
        addresses: [{ address: '203.0.113.10', family: 4 }],
      };
    };
    const provider = new LocalHttpProvider({
      resolveHost,
      httpFetch: async (args) => {
        requestedUrls.push(args.url.toString());
        return {
          status: 200,
          statusText: 'OK',
          ok: true,
          bodyText: content,
          bodyData,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'text/plain; charset=utf-8' : null;
            },
          },
          tookMs: 1,
        };
      },
    });
    const originalUrl = 'https://github.com/openai/codex/blob/main/README.md#introduction';

    const result = await provider.read({ url: originalUrl });

    expect(resolvedHosts).toEqual(['raw.githubusercontent.com']);
    expect(requestedUrls).toEqual(['https://raw.githubusercontent.com/openai/codex/main/README.md']);
    expect(result).toMatchObject({
      url: originalUrl,
      finalUrl: 'https://raw.githubusercontent.com/openai/codex/main/README.md',
      extractor: 'raw_text',
      content: content.trim(),
    });
  });
});
