import {
  WEB_SEARCH_ENGINE_IDS,
  type WebSearchConfig,
  type WebSearchConfigView,
  type WebSearchEngineId,
  type WebSearchKeySource,
} from '../../../../src/tools/web/websearch/definitions/webSearchConfig';

export interface WebSearchConnectionTestResult {
  readonly provider: string;
  readonly resultCount: number;
  readonly tookMs: number;
}

export type WebSearchConfigGatewayResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFailure(value: Record<string, unknown>): WebSearchConfigGatewayResult<never> | undefined {
  return value.success === false && typeof value.error === 'string'
    ? { success: false, error: value.error }
    : undefined;
}

function isEngine(value: unknown): value is WebSearchEngineId {
  return typeof value === 'string' && WEB_SEARCH_ENGINE_IDS.some((engine) => engine === value);
}

function isKeySource(value: unknown): value is WebSearchKeySource {
  return value === 'none' || value === 'byok' || value === 'cloud';
}

function parseConfigResult(value: unknown): WebSearchConfigGatewayResult<WebSearchConfigView> {
  if (!isRecord(value)) return { success: false, error: '主进程返回了无效的网络搜索配置响应。' };
  const failure = parseFailure(value);
  if (failure) return failure;
  const data = value.data;
  if (
    value.success !== true
    || !isRecord(data)
    || !isEngine(data.engine)
    || !isRecord(data.engines)
  ) {
    return { success: false, error: '主进程返回了无效的网络搜索配置响应。' };
  }
  const engines: WebSearchConfigView['engines'] = {};
  for (const engine of WEB_SEARCH_ENGINE_IDS) {
    const rawEngine = data.engines[engine];
    if (rawEngine === undefined) continue;
    if (
      !isRecord(rawEngine)
      || !isKeySource(rawEngine.keySource)
      || typeof rawEngine.hasByokKey !== 'boolean'
    ) {
      return { success: false, error: '主进程返回了无效的网络搜索配置响应。' };
    }
    engines[engine] = {
      keySource: rawEngine.keySource,
      hasByokKey: rawEngine.hasByokKey,
      ...(typeof rawEngine.searxngBaseUrl === 'string'
        ? { searxngBaseUrl: rawEngine.searxngBaseUrl }
        : {}),
    };
  }
  if (!engines[data.engine]) {
    return { success: false, error: '主进程返回了无效的网络搜索配置响应。' };
  }
  return {
    success: true,
    data: {
      engine: data.engine,
      engines,
    },
  };
}

function parseConnectionResult(value: unknown): WebSearchConfigGatewayResult<WebSearchConnectionTestResult> {
  if (!isRecord(value)) return { success: false, error: '主进程返回了无效的连接测试响应。' };
  const failure = parseFailure(value);
  if (failure) return failure;
  const data = value.data;
  if (
    value.success !== true
    || !isRecord(data)
    || typeof data.provider !== 'string'
    || typeof data.resultCount !== 'number'
    || typeof data.tookMs !== 'number'
  ) {
    return { success: false, error: '主进程返回了无效的连接测试响应。' };
  }
  return {
    success: true,
    data: { provider: data.provider, resultCount: data.resultCount, tookMs: data.tookMs },
  };
}

async function invoke(channel: string, data?: unknown): Promise<unknown> {
  const result = window.electronAPI?.invoke(channel, data);
  if (!result) throw new Error('Electron IPC 当前不可用。');
  return result;
}

export const webSearchConfigGateway = {
  async get(): Promise<WebSearchConfigGatewayResult<WebSearchConfigView>> {
    return parseConfigResult(await invoke('web-search-config:get'));
  },
  async set(config: WebSearchConfig): Promise<WebSearchConfigGatewayResult<WebSearchConfigView>> {
    return parseConfigResult(await invoke('web-search-config:set', config));
  },
  async testConnection(
    config: WebSearchConfig,
  ): Promise<WebSearchConfigGatewayResult<WebSearchConnectionTestResult>> {
    return parseConnectionResult(await invoke('web-search-config:test-connection', config));
  },
};
