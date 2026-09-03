// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webSearchConfigGateway } from './webSearchConfigGateway';

describe('renderer Web Search 配置 gateway', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  it('解析公开配置视图，拒绝把主进程外字段当作 Key', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: {
        engine: 'serper',
        engines: {
          serper: {
            keySource: 'byok',
            hasByokKey: true,
            byokKey: 'must-not-enter-view',
          },
        },
      },
    });
    await expect(webSearchConfigGateway.get()).resolves.toEqual({
      success: true,
      data: {
        engine: 'serper',
        engines: { serper: { keySource: 'byok', hasByokKey: true } },
      },
    });
  });

  it('保存和测试连接只调用三个白名单通道', async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          engine: 'parallel_free',
          engines: { parallel_free: { keySource: 'none', hasByokKey: false } },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { provider: 'parallel_free', resultCount: 1, tookMs: 120 },
      });
    const config = { engine: 'parallel_free' as const, keySource: 'none' as const };
    await webSearchConfigGateway.set(config);
    await webSearchConfigGateway.testConnection(config);
    expect(invoke.mock.calls).toEqual([
      ['web-search-config:set', config],
      ['web-search-config:test-connection', config],
    ]);
  });

  it('非法 IPC 响应不会伪装成功', async () => {
    invoke.mockResolvedValue({ success: true, data: { engine: 'unknown' } });
    await expect(webSearchConfigGateway.get()).resolves.toEqual({
      success: false,
      error: '主进程返回了无效的网络搜索配置响应。',
    });
  });

  it('接受 Jina 与 Tavily 的公开配置视图', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: {
        engine: 'jina_search',
        engines: { jina_search: { keySource: 'byok', hasByokKey: true } },
      },
    });
    await expect(webSearchConfigGateway.get()).resolves.toEqual({
      success: true,
      data: {
        engine: 'jina_search',
        engines: { jina_search: { keySource: 'byok', hasByokKey: true } },
      },
    });
  });
});
