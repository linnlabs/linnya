// @vitest-environment jsdom
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'X-API-Token');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    handler(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture has no TCP port');
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return address.port;
}

async function loadClient(port: number, refresh = false) {
  vi.resetModules();
  let calls = 0;
  vi.stubGlobal('window', { electronAPI: { invoke: async () => ({ port, token: refresh && calls++ > 0 ? 'new-session' : 'test-session' }) } });
  return import('./localApiClient');
}

it('发送真实multipart、认证与进度，正式响应交给调用方解码', async () => {
  let received = '';
  let contentType = '';
  const port = await fixture((request, response) => {
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/v1/plugins/knowledge/documents/upload');
    expect(request.headers['x-api-token']).toBe('test-session');
    contentType = request.headers['content-type'] ?? '';
    request.setEncoding('utf8');
    request.on('data', chunk => { received += chunk; });
    request.on('end', () => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ taskId: 'one' })); });
  });
  const client = await loadClient(port);
  const formData = new FormData();
  formData.append('kbId', 'kb-one');
  formData.append('file', new File(['synthetic source'], 'sample.md', { type: 'text/markdown' }));
  const progress = vi.fn();
  await expect(client.apiMultipartPost('/api/v1/plugins/knowledge/documents/upload', formData, { onProgress: progress })).resolves.toEqual({ taskId: 'one' });
  expect(contentType).toContain('multipart/form-data; boundary=');
  expect(received).toContain('synthetic source');
  expect(received).toContain('name="kbId"');
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ loaded: expect.any(Number) }));
});

it('仅会话更新后的401重试，保留业务错误body，不自动重试其他失败', async () => {
  let requests = 0;
  const port = await fixture((request, response) => {
    requests++;
    response.setHeader('Content-Type', 'application/json');
    if (request.headers['x-api-token'] === 'test-session') response.writeHead(401).end(JSON.stringify({ error: 'expired' }));
    else response.writeHead(409).end(JSON.stringify({ error: 'saved source must be rebuilt' }));
  });
  const client = await loadClient(port, true);
  await expect(client.apiMultipartPost('/api/v1/plugins/knowledge/documents/upload', new FormData())).rejects.toMatchObject({
    response: { status: 409, data: { error: 'saved source must be rebuilt' } },
  });
  expect(requests).toBe(2);
});

it('AbortSignal关闭真实HTTP等待，不再发送重试', async () => {
  let accepted: () => void = () => {};
  const ready = new Promise<void>(resolve => { accepted = resolve; });
  let requests = 0;
  const port = await fixture(() => { requests++; accepted(); });
  const client = await loadClient(port);
  const controller = new AbortController();
  const pending = client.apiMultipartPost('/api/v1/plugins/knowledge/documents/upload', new FormData(), { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await ready;
  controller.abort();
  await assertion;
  expect(requests).toBe(1);
});
