import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAllowedWebUrl, resolveAndAssertPublicHost } from '../../tools/web/shared/urlPolicy';
import { createElectronWebPageRenderRuntime } from './electronWebPageRenderRuntime';

const state = vi.hoisted((): {
  beforeRequest: ((
    details: { url: string; resourceType: string },
    callback: (response: { cancel: boolean }) => void,
  ) => void) | null;
} => ({ beforeRequest: null }));

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
      },
    }),
  },
}));

async function request(url: string, resourceType = 'mainFrame'): Promise<{ cancel: boolean }> {
  const beforeRequest = state.beforeRequest;
  if (!beforeRequest) throw new Error('Security guards not installed');
  return new Promise(resolve => beforeRequest({ url, resourceType }, resolve));
}

beforeEach(() => { state.beforeRequest = null; });

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
