import { createServer, type Server } from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResolvedWebHost } from '../../../tools/web/shared/urlPolicy';
import { getWebFailureKind } from '../../../tools/web/shared/webFailure';
import { localHttpFetch } from './localHttpFetchAdapter';

describe('localHttpFetch 本地真实 HTTP 合同', () => {
  let server: Server;
  let port = 0;
  const requestedPaths: string[] = [];
  let latestIfModifiedSince: string | undefined;
  const transientAttempts = new Map<string, number>();

  beforeAll(async () => {
    server = createServer((request, response) => {
      requestedPaths.push(request.url ?? '');
      if (request.url === '/retry-503' || request.url === '/retry-429') {
        const attempts = (transientAttempts.get(request.url) ?? 0) + 1;
        transientAttempts.set(request.url, attempts);
        if (attempts === 1) {
          response.writeHead(request.url === '/retry-429' ? 429 : 503, {
            'Content-Type': 'text/plain',
            ...(request.url === '/retry-429' ? { 'Retry-After': '0' } : {}),
          });
          response.end('temporary failure');
          return;
        }
      }
      if (request.url === '/not-modified') {
        const header = request.headers['if-modified-since'];
        latestIfModifiedSince = Array.isArray(header) ? header.join(', ') : header;
        response.writeHead(304, { 'Last-Modified': 'Fri, 17 Jul 2026 12:00:00 GMT' });
        response.end();
        return;
      }
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: `http://redirected.test:${port}/article` });
        response.end();
        return;
      }
      if (request.url === '/private-redirect') {
        response.writeHead(302, { Location: `http://127.0.0.1:${port}/article` });
        response.end();
        return;
      }
      if (request.url === '/slow') {
        setTimeout(() => response.end('late'), 250);
        return;
      }
      if (request.url === '/large') {
        response.end('x'.repeat(4_096));
        return;
      }
      if (request.url === '/latin') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' });
        response.end(Buffer.from('<html><body>caf\xe9</body></html>', 'latin1'));
        return;
      }
      if (request.url === '/gzip') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
        response.end(gzipSync('<html><body>gzip 正文</body></html>'));
        return;
      }
      if (request.url === '/brotli') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'br' });
        response.end(brotliCompressSync('<html><body>brotli 正文</body></html>'));
        return;
      }
      if (request.url === '/pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' });
        response.end('%PDF-fixture');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>Fixture</title></head><body>本地抓取正文</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('本地抓取测试服务未返回 TCP 地址。');
    port = address.port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const resolveFixtureHost = async (url: URL): Promise<ResolvedWebHost> => ({
    hostname: url.hostname,
    addresses: [{ address: '127.0.0.1', family: 4 }],
  });

  it('以 GET 抓取 HTML 并返回观测字段', async () => {
    const result = await localHttpFetch(`http://fixture.test:${port}/article`, {}, {
      resolveHost: resolveFixtureHost,
    });
    expect(result).toMatchObject({
      status: 200,
      finalUrl: `http://fixture.test:${port}/article`,
      mimeType: 'text/html',
      charset: 'utf-8',
      redirectCount: 0,
    });
    expect(result.bodyText).toContain('本地抓取正文');
    expect(result.rawLength).toBeGreaterThan(0);
  });

  it('每一跳重定向都重新解析并固定到已校验地址', async () => {
    const resolvedHosts: string[] = [];
    const result = await localHttpFetch(`http://fixture.test:${port}/redirect`, {}, {
      resolveHost: async (url) => {
        resolvedHosts.push(url.hostname);
        return resolveFixtureHost(url);
      },
    });
    expect(resolvedHosts).toEqual(['fixture.test', 'redirected.test']);
    expect(result.finalUrl).toBe(`http://redirected.test:${port}/article`);
    expect(result.redirectCount).toBe(1);
  });

  it('重定向到私网字面地址时在第二跳发请求前拒绝', async () => {
    const before = requestedPaths.filter((path) => path === '/article').length;
    await expect(localHttpFetch(`http://fixture.test:${port}/private-redirect`, {}, {
      resolveHost: resolveFixtureHost,
    })).rejects.toMatchObject({ kind: 'policy_denied' });
    expect(requestedPaths.filter((path) => path === '/article')).toHaveLength(before);
  });

  it('总 deadline 和解压后响应体上限保持稳定失败分类', async () => {
    await expect(localHttpFetch(`http://fixture.test:${port}/slow`, { timeoutMs: 30 }, {
      resolveHost: resolveFixtureHost,
    })).rejects.toMatchObject({ kind: 'timeout' });
    await expect(localHttpFetch(`http://fixture.test:${port}/large`, { maxBodyBytes: 128 }, {
      resolveHost: resolveFixtureHost,
    })).rejects.toMatchObject({ kind: 'body_too_large' });
  });

  it('对单次本地 GET 瞬态 5xx/429 只重试一次并保留尝试计数', async () => {
    const fiveHundred = await localHttpFetch(`http://fixture.test:${port}/retry-503`, {
      timeoutMs: 2_000,
    }, { resolveHost: resolveFixtureHost, sleep: async () => undefined });
    expect(fiveHundred).toMatchObject({ attemptCount: 2, retryCount: 1, status: 200 });

    const rateLimited = await localHttpFetch(`http://fixture.test:${port}/retry-429`, {
      timeoutMs: 2_000,
    }, { resolveHost: resolveFixtureHost, sleep: async () => undefined });
    expect(rateLimited).toMatchObject({ attemptCount: 2, retryCount: 1, status: 200 });
  });

  it('挑战页不会被瞬态重试误判', async () => {
    // 使用注入的 HTTP 函数验证分类逻辑，避免把真实测试服务改成一次性状态。
    const error = await localHttpFetch('http://fixture.test/challenge', {}, {
      resolveHost: resolveFixtureHost,
      sleep: async () => undefined,
      httpFetch: async () => ({
        status: 419,
        statusText: 'Page Expired',
        ok: false,
        bodyText: '<html><title>Human verification</title></html>',
        bodyData: new TextEncoder().encode('<html><title>Human verification</title></html>'),
        headers: { get: (name: string) => name === 'content-type' ? 'text/html' : null },
        tookMs: 0,
      }),
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 419, retryCount: 0 });
    expect(getWebFailureKind(error)).toBe('captcha');
  });

  it.each([
    ['/gzip', 'gzip 正文'],
    ['/brotli', 'brotli 正文'],
  ])('透明解压 %s 响应', async (path, expected) => {
    const result = await localHttpFetch(`http://fixture.test:${port}${path}`, {}, {
      resolveHost: resolveFixtureHost,
    });
    expect(result.bodyText).toContain(expected);
  });

  it('按 Content-Type charset 解码非 UTF-8 HTML', async () => {
    const result = await localHttpFetch(`http://fixture.test:${port}/latin`, {}, {
      resolveHost: resolveFixtureHost,
    });
    expect(result.charset).toBe('iso-8859-1');
    expect(result.bodyText).toContain('café');
  });

  it('保留不支持的二进制 MIME，交由 provider/阶梯判定', async () => {
    const result = await localHttpFetch(`http://fixture.test:${port}/pdf`, {}, {
      resolveHost: resolveFixtureHost,
    });
    expect(result.mimeType).toBe('application/pdf');
  });

  it('发送 Last-Modified 条件头并保留 304 结果，不把它映射为上游失败', async () => {
    const result = await localHttpFetch(`http://fixture.test:${port}/not-modified`, {
      validators: { lastModified: 'Fri, 17 Jul 2026 12:00:00 GMT' },
    }, {
      resolveHost: resolveFixtureHost,
    });
    expect(result).toMatchObject({
      notModified: true,
      status: 304,
      lastModified: 'Fri, 17 Jul 2026 12:00:00 GMT',
      rawLength: 0,
    });
    expect(latestIfModifiedSince).toBe('Fri, 17 Jul 2026 12:00:00 GMT');
  });
});
