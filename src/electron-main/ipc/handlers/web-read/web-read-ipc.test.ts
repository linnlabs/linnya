import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEB_READ_SETTINGS,
  type WebReadConfig,
  type WebReadSettings,
} from '../../../../tools/web/webread/definitions/webReadConfig';
import { createWebReadResult } from '../../../../tools/web/webread/functions/createWebReadResult';
import { projectActiveWebReadConfig } from '../../../../tools/web/webread/functions/projectActiveWebReadConfig';
import { resolveWebReadConfigUpdate } from '../../../../tools/web/webread/functions/resolveWebReadConfigUpdate';
import type { WebReadProvider } from '../../../../tools/web/webread/providers/types';

type IpcHandler = (event: undefined, input?: unknown) => unknown | Promise<unknown>;

const registeredHandlers = new Map<string, IpcHandler>();

const ipc = {
  handle(channel: string, handler: IpcHandler): void {
    registeredHandlers.set(channel, handler);
  },
};

class MemoryStore {
  private settings: WebReadSettings = DEFAULT_WEB_READ_SETTINGS;

  read(): WebReadConfig {
    return projectActiveWebReadConfig(this.settings);
  }

  readSettings(): WebReadSettings {
    return this.settings;
  }

  preview(input: unknown): WebReadConfig {
    return projectActiveWebReadConfig(resolveWebReadConfigUpdate(input, this.settings));
  }

  save(input: unknown): WebReadSettings {
    this.settings = resolveWebReadConfigUpdate(input, this.settings);
    return this.settings;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function invoke(channel: string, input?: unknown): Promise<Record<string, unknown>> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`IPC handler 未注册: ${channel}`);
  const result = await handler(undefined, input);
  if (!isRecord(result)) throw new Error(`IPC handler 返回值无效: ${channel}`);
  return result;
}

describe('网络读取配置 IPC', () => {
  const read = vi.fn(async () => createWebReadResult({
    url: 'https://example.com/',
    status: 200,
    contentType: 'text/markdown',
    title: 'Example Domain',
    content: 'Connection fixture content',
    contentFormat: 'markdown',
    extractor: 'fixture_reader',
    renderMode: 'managed',
    rawLength: 26,
    latencyMs: 1,
  }));

  beforeEach(async () => {
    registeredHandlers.clear();
    read.mockClear();
    const provider: WebReadProvider = { name: 'fixture_reader', read };
    const { registerWebReadConfigHandlers } = await import('./web-read-ipc');
    await registerWebReadConfigHandlers(ipc, {
      store: new MemoryStore(),
      createProvider: () => provider,
      hasFallbackCredential: (reader) => reader === 'jina_reader',
    });
  });

  it('get/set 只返回掩码视图，不回传 BYOK Key', async () => {
    const saved = await invoke('web-read-config:set', {
      renderEnabled: false,
      managedReader: 'metaso_reader',
      byokKey: 'must-not-leak',
    });
    expect(saved).toEqual({
      success: true,
      data: {
        renderEnabled: false,
        managedReader: 'metaso_reader',
        readers: {
          metaso_reader: { hasStoredByokKey: true, credentialAvailable: true },
          jina_reader: { hasStoredByokKey: false, credentialAvailable: true },
        },
      },
    });
    expect(JSON.stringify(saved)).not.toContain('must-not-leak');
    expect(await invoke('web-read-config:get')).toEqual(saved);
  });

  it('set 只更新目标 Reader，切换后保留两边凭证状态', async () => {
    await invoke('web-read-config:set', {
      renderEnabled: true,
      managedReader: 'metaso_reader',
      byokKey: 'metaso-key',
    });
    const saved = await invoke('web-read-config:set', {
      renderEnabled: true,
      managedReader: 'jina_reader',
      byokKey: 'jina-key',
    });

    expect(saved).toMatchObject({
      success: true,
      data: {
        managedReader: 'jina_reader',
        readers: {
          metaso_reader: { hasStoredByokKey: true },
          jina_reader: { hasStoredByokKey: true },
        },
      },
    });
    expect(JSON.stringify(saved)).not.toContain('metaso-key');
    expect(JSON.stringify(saved)).not.toContain('jina-key');
  });

  it('testConnection 只调用当前 Reader，并返回可行动结果', async () => {
    const result = await invoke('web-read-config:test-connection', {
      renderEnabled: true,
      managedReader: 'jina_reader',
      byokKey: 'jina-key',
    });

    expect(result).toMatchObject({
      success: true,
      data: { provider: 'fixture_reader', charCount: 26 },
    });
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith({ url: 'https://example.com/', maxChars: 1_000 });
  });

  it('关闭托管 Reader 时明确拒绝连接测试', async () => {
    const result = await invoke('web-read-config:test-connection', {
      renderEnabled: true,
      managedReader: 'none',
    });

    expect(result).toEqual({ success: false, error: '仅使用本机解析时无需测试第三方连接。' });
    expect(read).not.toHaveBeenCalled();
  });
});
