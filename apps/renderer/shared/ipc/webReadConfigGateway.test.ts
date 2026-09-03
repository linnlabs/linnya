// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webReadConfigGateway } from './webReadConfigGateway';

describe('renderer 网络读取配置 gateway', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  it('只解析掩码视图，丢弃主进程返回的凭证明文', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: {
        renderEnabled: true,
        managedReader: 'metaso_reader',
        readers: {
          metaso_reader: {
            hasStoredByokKey: true,
            credentialAvailable: true,
            byokKey: 'must-not-enter-view',
          },
          jina_reader: { hasStoredByokKey: false, credentialAvailable: true },
        },
      },
    });

    await expect(webReadConfigGateway.get()).resolves.toEqual({
      success: true,
      data: {
        renderEnabled: true,
        managedReader: 'metaso_reader',
        readers: {
          metaso_reader: { hasStoredByokKey: true, credentialAvailable: true },
          jina_reader: { hasStoredByokKey: false, credentialAvailable: true },
        },
      },
    });
  });

  it('保存和测试连接只调用三个网络读取白名单通道', async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          renderEnabled: false,
          managedReader: 'jina_reader',
          readers: {
            metaso_reader: { hasStoredByokKey: false, credentialAvailable: false },
            jina_reader: { hasStoredByokKey: true, credentialAvailable: true },
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { provider: 'jina_reader_direct', charCount: 512, tookMs: 120 },
      });
    const config = {
      renderEnabled: false,
      managedReader: 'jina_reader' as const,
      byokKey: 'jina-key',
    };

    await webReadConfigGateway.set(config);
    await webReadConfigGateway.testConnection(config);

    expect(invoke.mock.calls).toEqual([
      ['web-read-config:set', config],
      ['web-read-config:test-connection', config],
    ]);
  });

  it('缺少任一 Reader 状态时拒绝伪装成功', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: {
        renderEnabled: true,
        managedReader: 'none',
        readers: {
          metaso_reader: { hasStoredByokKey: false, credentialAvailable: false },
        },
      },
    });

    await expect(webReadConfigGateway.get()).resolves.toEqual({
      success: false,
      error: '主进程返回了无效的网络读取配置响应。',
    });
  });
});
