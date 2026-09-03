import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchConfig,
  type WebSearchSettings,
} from '../../../../tools/web/websearch/definitions/webSearchConfig';
import { projectActiveWebSearchConfig } from '../../../../tools/web/websearch/functions/projectActiveWebSearchConfig';
import { resolveWebSearchConfigUpdate } from '../../../../tools/web/websearch/functions/resolveWebSearchConfigUpdate';
import type { WebSearchProvider } from '../../../../tools/web/websearch/providers/types';

type IpcHandler = (event: undefined, input?: unknown) => unknown | Promise<unknown>;

const registeredHandlers = new Map<string, IpcHandler>();

const ipc = {
  handle(channel: string, handler: IpcHandler): void {
    registeredHandlers.set(channel, handler);
  },
};

class MemoryStore {
  private settings: WebSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS;

  read(): WebSearchConfig {
    return projectActiveWebSearchConfig(this.settings);
  }

  readSettings(): WebSearchSettings {
    return this.settings;
  }

  preview(input: unknown): WebSearchConfig {
    return projectActiveWebSearchConfig(resolveWebSearchConfigUpdate(input, this.settings));
  }

  save(input: unknown): WebSearchSettings {
    this.settings = resolveWebSearchConfigUpdate(input, this.settings);
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

describe('Web Search 配置 IPC', () => {
  const search = vi.fn(async () => [{
    title: 'Fixture',
    url: 'https://example.com',
    canonicalUrl: 'https://example.com/',
    snippet: 'Fixture result',
    siteName: 'example.com',
    provider: 'parallel_free',
    query: 'Linnya AI',
    rank: 1,
    cached: false,
    latencyMs: 1,
  }]);

  beforeEach(async () => {
    registeredHandlers.clear();
    search.mockClear();
    const provider: WebSearchProvider = { name: 'parallel_free', search };
    const { registerWebSearchConfigHandlers } = await import('./web-search-ipc');
    await registerWebSearchConfigHandlers(ipc, {
      store: new MemoryStore(),
      createProvider: () => provider,
    });
  });

  it('get/set 返回公开视图，不回传 BYOK Key', async () => {
    const saved = await invoke('web-search-config:set', {
      engine: 'serper',
      keySource: 'byok',
      byokKey: 'must-not-leak',
    });
    expect(saved).toEqual({
      success: true,
      data: {
        engine: 'serper',
        engines: {
          parallel_free: { keySource: 'none', hasByokKey: false },
          serper: { keySource: 'byok', hasByokKey: true },
        },
      },
    });
    expect(JSON.stringify(saved)).not.toContain('must-not-leak');
    expect(await invoke('web-search-config:get')).toEqual(saved);
  });

  it('set 只更新目标引擎，切换后公开视图保留两边的凭证状态', async () => {
    await invoke('web-search-config:set', {
      engine: 'serper', keySource: 'byok', byokKey: 'serper-key',
    });
    const saved = await invoke('web-search-config:set', {
      engine: 'tavily', keySource: 'byok', byokKey: 'tavily-key',
    });

    expect(saved).toMatchObject({
      success: true,
      data: {
        engine: 'tavily',
        engines: {
          serper: { keySource: 'byok', hasByokKey: true },
          tavily: { keySource: 'byok', hasByokKey: true },
        },
      },
    });
    expect(JSON.stringify(saved)).not.toContain('serper-key');
    expect(JSON.stringify(saved)).not.toContain('tavily-key');
  });

  it('testConnection 直接调用当前 Provider，并返回可行动的结果', async () => {
    const result = await invoke('web-search-config:test-connection', {
      engine: 'parallel_free',
      keySource: 'none',
    });
    expect(result).toMatchObject({
      success: true,
      data: { provider: 'parallel_free', resultCount: 1 },
    });
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({ query: 'Linnya AI', topK: 1 });
  });

  it('非法组合在 IPC 边界明确失败', async () => {
    const result = await invoke('web-search-config:set', {
      engine: 'parallel_free',
      keySource: 'byok',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('不支持 Key 来源');
  });
});
