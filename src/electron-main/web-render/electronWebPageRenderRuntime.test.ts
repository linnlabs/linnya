import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAllowedWebUrl, resolveAndAssertPublicHost } from '../../tools/web/shared/urlPolicy';
import { createElectronWebPageRenderRuntime } from './electronWebPageRenderRuntime';

type HeadersReceivedListener = (
  details: {
    url: string;
    resourceType: string;
    statusCode: number;
    responseHeaders?: Record<string, string[]>;
  },
  callback: (response: { cancel?: boolean }) => void,
) => void;

const state = vi.hoisted((): {
  beforeRequest: ((
    details: { url: string; resourceType: string },
    callback: (response: { cancel: boolean }) => void,
  ) => void) | null;
  headersReceived: HeadersReceivedListener | null;
  dataListeners: Record<string, ((details: { id: number; resourceType: string; error?: string }) => void) | null>;
} => ({ beforeRequest: null, headersReceived: null, dataListeners: {} }));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: () => ({
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      webRequest: {
        onBeforeRequest: (_filter: unknown, listener: typeof state.beforeRequest) => {
          state.beforeRequest = listener;
        },
        onHeadersReceived: (_filter: unknown, listener: typeof state.headersReceived) => {
          state.headersReceived = listener;
        },
        onSendHeaders: (_filter: unknown, listener: (details: { id: number; resourceType: string }) => void) => {
          state.dataListeners.sendHeaders = listener;
        },
        onCompleted: (_filter: unknown, listener: (details: { id: number; resourceType: string }) => void) => {
          state.dataListeners.completed = listener;
        },
        onErrorOccurred: (_filter: unknown, listener: (details: { id: number; resourceType: string; error?: string }) => void) => {
          state.dataListeners.errorOccurred = listener;
        },
      },
    }),
  },
}));

async function request(url: string, resourceType = 'mainFrame'): Promise<{ cancel: boolean }> {
  const beforeRequest = state.beforeRequest;
  if (!beforeRequest) throw new Error('Security guards not installed');
  return new Promise(resolve => beforeRequest({ url, resourceType }, resolve));
}

function receiveHeaders(
  details: Parameters<HeadersReceivedListener>[0],
): { cancel?: boolean } {
  const headersReceived = state.headersReceived;
  if (!headersReceived) throw new Error('Response observer not installed');
  let response: { cancel?: boolean } | undefined;
  headersReceived(details, (value) => { response = value; });
  if (!response) throw new Error('Response observer did not answer synchronously');
  return response;
}

beforeEach(() => {
  state.beforeRequest = null;
  state.headersReceived = null;
  state.dataListeners = {};
});

describe('渲染请求 URL/DNS 准入', () => {
  it('每次主框架请求重新准入，既有子资源缓存不能放行 DNS 后来转为私网的同主机', async () => {
    let address = '93.184.216.34';
    const lookupHost = vi.fn(async () => [{ address, family: 4 }]);
    const validateRequestUrl = vi.fn(async (rawUrl: string) => {
      await resolveAndAssertPublicHost(assertAllowedWebUrl(rawUrl), { lookupHost });
    });
    const session = createElectronWebPageRenderRuntime({ validateRequestUrl }).createSession('test');
    const cleanup = session.installSecurityGuards();

    expect(await request('https://www.example.com/script.js', 'script')).toEqual({ cancel: false });
    expect(await request('https://www.example.com/other.js', 'script')).toEqual({ cancel: false });
    expect(lookupHost).toHaveBeenCalledTimes(1);
    expect(await request('https://www.example.com/start')).toEqual({ cancel: false });
    expect(await request('https://example.com/canonical')).toEqual({ cancel: false });
    expect(lookupHost).toHaveBeenCalledTimes(3);

    address = '127.0.0.1';
    expect(await request('https://www.example.com/redirect')).toEqual({ cancel: true });
    expect(lookupHost).toHaveBeenCalledTimes(4);
    cleanup();
    expect(state.beforeRequest).toBeNull();
  });

  it('主框架不因 hostname 已通过就跳过 URL 级凭据校验；清理后子资源也重新准入', async () => {
    const validateRequestUrl = vi.fn(async (rawUrl: string) => { assertAllowedWebUrl(rawUrl); });
    const session = createElectronWebPageRenderRuntime({ validateRequestUrl }).createSession('test');
    session.installSecurityGuards();
    expect(await request('https://example.com/one', 'script')).toEqual({ cancel: false });
    expect(await request('https://user:password@example.com/redirect')).toEqual({ cancel: true });
    await session.clearStorageData();
    expect(await request('https://example.com/two', 'script')).toEqual({ cancel: false });
    expect(validateRequestUrl).toHaveBeenCalledTimes(3);
  });
});

describe('主框架响应头观察', () => {
  it('只把主框架响应交给观察者，头名小写并合并同名多值，按决定取消', () => {
    const session = createElectronWebPageRenderRuntime().createSession('test');
    const listener = vi.fn((response: {
      url: string;
      statusCode: number;
      headers: { get(name: string): string | null | undefined };
    }) => (response.headers.get('x-amzn-waf-action') === 'challenge' ? 'cancel' as const : 'continue' as const));
    const cleanup = session.observeMainFrameResponses(listener);

    expect(receiveHeaders({
      url: 'https://example.com/app.js',
      resourceType: 'script',
      statusCode: 202,
      responseHeaders: { 'x-amzn-waf-action': ['challenge'] },
    })).toEqual({});
    expect(listener).not.toHaveBeenCalled();

    expect(receiveHeaders({
      url: 'https://example.com/page',
      resourceType: 'mainFrame',
      statusCode: 202,
      responseHeaders: { 'X-Amzn-Waf-Action': ['challenge'] },
    })).toEqual({ cancel: true });
    expect(receiveHeaders({
      url: 'https://example.com/page',
      resourceType: 'mainFrame',
      statusCode: 200,
      responseHeaders: { Vary: ['Accept'], vary: ['Origin'] },
    })).toEqual({});
    const lastResponse = listener.mock.calls[listener.mock.calls.length - 1]?.[0];
    expect(lastResponse?.statusCode).toBe(200);
    expect(lastResponse?.headers.get('VARY')).toBe('Accept, Origin');

    cleanup();
    expect(state.headersReceived).toBeNull();
  });

  it('观察者异常时拒绝主文档，异常不逃逸到 Electron 网络回调', () => {
    const session = createElectronWebPageRenderRuntime().createSession('test');
    session.observeMainFrameResponses(() => {
      throw new Error('observer failed');
    });
    expect(receiveHeaders({
      url: 'https://example.com/page',
      resourceType: 'mainFrame',
      statusCode: 200,
    })).toEqual({ cancel: true });
  });
});

describe('子资源观察', () => {
  it('数据请求报告发出/完成/失败，脚本与样式表报告失败及错误名，其他资源不计入；清理后解除监听', () => {
    const session = createElectronWebPageRenderRuntime().createSession('test');
    const events: unknown[] = [];
    const cleanup = session.observeSubresources((event) => events.push(event));

    state.dataListeners.sendHeaders?.({ id: 1, resourceType: 'xhr' });
    state.dataListeners.sendHeaders?.({ id: 2, resourceType: 'image' });
    state.dataListeners.completed?.({ id: 1, resourceType: 'xhr' });
    state.dataListeners.errorOccurred?.({ id: 3, resourceType: 'script', error: 'net::ERR_SSL_PROTOCOL_ERROR' });
    state.dataListeners.errorOccurred?.({ id: 4, resourceType: 'stylesheet', error: 'net::ERR_CONNECTION_CLOSED' });
    state.dataListeners.errorOccurred?.({ id: 5, resourceType: 'image', error: 'net::ERR_FAILED' });

    expect(events).toEqual([
      { id: 1, category: 'data', phase: 'started' },
      { id: 1, category: 'data', phase: 'completed' },
      { id: 3, category: 'script_or_style', phase: 'failed', error: 'net::ERR_SSL_PROTOCOL_ERROR' },
      { id: 4, category: 'script_or_style', phase: 'failed', error: 'net::ERR_CONNECTION_CLOSED' },
    ]);
    cleanup();
    expect(state.dataListeners).toEqual({ sendHeaders: null, completed: null, errorOccurred: null });
  });
});
