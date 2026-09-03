import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webHttpFetch } from './webHttpFetch';

describe('webHttpFetch 真实 HTTP 合同', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/slow') {
        setTimeout(() => response.end('late'), 250);
        return;
      }
      if (request.url === '/large') {
        response.end('x'.repeat(4_096));
        return;
      }
      if (request.url === '/cancel') {
        const timer = setInterval(() => response.write('chunk'), 20);
        request.once('close', () => clearInterval(timer));
        return;
      }
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('测试 HTTP 服务未返回 TCP 地址。');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('deadline 到达后中止请求并分类为 timeout', async () => {
    const promise = webHttpFetch({
      url: `${baseUrl}/slow`,
      method: 'GET',
      timeoutMs: 30,
      maxBodyBytes: 1_024,
    });

    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('读取过程中超过字节预算后立即失败', async () => {
    const promise = webHttpFetch({
      url: `${baseUrl}/large`,
      method: 'GET',
      timeoutMs: 1_000,
      maxBodyBytes: 128,
    });

    await expect(promise).rejects.toMatchObject({ kind: 'body_too_large' });
  });

  it('透传调用方取消并分类为 aborted', async () => {
    const controller = new AbortController();
    const promise = webHttpFetch({
      url: `${baseUrl}/cancel`,
      method: 'GET',
      signal: controller.signal,
      timeoutMs: 1_000,
      maxBodyBytes: 1_024,
    });
    setTimeout(() => controller.abort(), 40);

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });
});
