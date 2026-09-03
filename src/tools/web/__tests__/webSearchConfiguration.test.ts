import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  DEFAULT_WEB_SEARCH_SETTINGS,
} from '../websearch/definitions/webSearchConfig';
import {
  normalizeWebSearchConfig,
  toWebSearchConfigView,
} from '../websearch/functions/normalizeWebSearchConfig';
import { projectActiveWebSearchConfig } from '../websearch/functions/projectActiveWebSearchConfig';
import { resolveWebSearchConfigUpdate } from '../websearch/functions/resolveWebSearchConfigUpdate';
import { createWebSearchProvider } from '../websearch/providers/factory';

describe('Web Search 配置与服务选择', () => {
  it('全新配置固定选择 Parallel Free，不读取模型目录', () => {
    expect(createWebSearchProvider(DEFAULT_WEB_SEARCH_CONFIG, {
      environment: {},
    }).name).toBe('parallel_free');
  });

  it('显式引擎选择只创建当前搜索服务', () => {
    expect(createWebSearchProvider({ engine: 'duckduckgo', keySource: 'none' }).name)
      .toBe('duckduckgo');
    expect(createWebSearchProvider({
      engine: 'searxng',
      keySource: 'none',
      searxngBaseUrl: 'https://search.example.com/',
    }).name).toBe('searxng');
  });

  it('BYOK 优先使用配置 Key，缺失时才读取开发环境变量', () => {
    expect(createWebSearchProvider({
      engine: 'serper',
      keySource: 'byok',
      byokKey: 'saved-key',
    }, { environment: {} }).name).toBe('serper');
    expect(createWebSearchProvider({
      engine: 'baidu_qianfan',
      keySource: 'byok',
    }, { environment: { BAIDU_SEARCH_API_KEY: 'development-key' } }).name)
      .toBe('baidu_qianfan_web_search');
    expect(createWebSearchProvider({
      engine: 'jina_search',
      keySource: 'byok',
    }, { environment: { JINA_API_KEY: 'development-key' } }).name).toBe('jina_search');
    expect(createWebSearchProvider({
      engine: 'tavily',
      keySource: 'byok',
      byokKey: 'saved-key',
    }, { environment: {} }).name).toBe('tavily');
  });

  it('缺凭证时明确失败，不切换免费搜索服务', () => {
    expect(() => createWebSearchProvider({
      engine: 'serper',
      keySource: 'byok',
    }, { environment: {} })).toThrowError(expect.objectContaining({ code: 'missing_credentials' }));
  });

  it('配置归一锁定合法组合、SearXNG URL 与凭证掩码', () => {
    expect(() => normalizeWebSearchConfig({
      engine: 'parallel_free',
      keySource: 'byok',
    })).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    expect(() => normalizeWebSearchConfig({
      engine: 'serper',
      keySource: 'cloud',
    })).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    expect(() => normalizeWebSearchConfig({
      engine: 'searxng',
      keySource: 'none',
      searxngBaseUrl: 'file:///tmp/searx',
    })).toThrowError(expect.objectContaining({ code: 'invalid_config' }));

    const settings = resolveWebSearchConfigUpdate({
      engine: 'serper', keySource: 'byok', byokKey: 'secret-key',
    });
    expect(toWebSearchConfigView(settings)).toEqual({
      engine: 'serper',
      engines: {
        parallel_free: { keySource: 'none', hasByokKey: false },
        serper: { keySource: 'byok', hasByokKey: true },
      },
    });
  });

  it('按引擎更新独立槽位，并只投影当前引擎给搜索工厂', () => {
    const withSerper = resolveWebSearchConfigUpdate({
      engine: 'serper', keySource: 'byok', byokKey: 'serper-key',
    }, DEFAULT_WEB_SEARCH_SETTINGS);
    const withTavily = resolveWebSearchConfigUpdate({
      engine: 'tavily', keySource: 'byok', byokKey: 'tavily-key',
    }, withSerper);
    const backToSerper = resolveWebSearchConfigUpdate({
      engine: 'serper', keySource: 'byok',
    }, withTavily);

    expect(projectActiveWebSearchConfig(withTavily)).toEqual({
      engine: 'tavily', keySource: 'byok', byokKey: 'tavily-key',
    });
    expect(projectActiveWebSearchConfig(backToSerper)).toEqual({
      engine: 'serper', keySource: 'byok', byokKey: 'serper-key',
    });
  });
});
