import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('aiService common local API session', () => {
  let originalWindow;
  let originalFetch;

  beforeEach(() => {
    vi.resetModules();
    originalWindow = globalThis.window;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('401 后刷新本地 API 会话，并用同一份端口/token 快照重试一次', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ port: 3101, token: 'old-token' })
      .mockResolvedValueOnce({ port: 3102, token: 'new-token' });

    globalThis.window = {
      electronAPI: {
        onApiPortSet: vi.fn(),
        invoke,
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const { apiFetch } = await import('./common.js');
    const response = await apiFetch('http://127.0.0.1:3101/api/v1/conversation/list');

    expect(response.status).toBe(200);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3101/api/v1/conversation/list');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-API-Token')).toBe('old-token');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:3102/api/v1/conversation/list');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('X-API-Token')).toBe('new-token');
  });

  it('非 401 错误响应不会被刷新重试掩盖', async () => {
    const invoke = vi.fn().mockResolvedValue({ port: 3101, token: 'valid-token' });

    globalThis.window = {
      electronAPI: {
        onApiPortSet: vi.fn(),
        invoke,
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }));
    globalThis.fetch = fetchMock;

    const { apiFetch } = await import('./common.js');
    const response = await apiFetch('http://127.0.0.1:3101/api/v1/conversation/list');

    expect(response.status).toBe(500);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('旧端口断连时，如果主进程会话已变化，会切到新端口重试一次', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ port: 3101, token: 'old-token' })
      .mockResolvedValueOnce({ port: 3102, token: 'new-token' });

    globalThis.window = {
      electronAPI: {
        onApiPortSet: vi.fn(),
        invoke,
      },
    };

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const { apiFetch } = await import('./common.js');
    const response = await apiFetch('http://127.0.0.1:3101/api/v1/models');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:3102/api/v1/models');
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('X-API-Token')).toBe('new-token');
  });
});
