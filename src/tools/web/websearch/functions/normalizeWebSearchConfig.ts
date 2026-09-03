import {
  WEB_SEARCH_ENGINE_IDS,
  WEB_SEARCH_KEY_SOURCES,
  WebSearchConfigurationError,
  type WebSearchConfig,
  type WebSearchConfigView,
  type WebSearchCredentialSlot,
  type WebSearchEngineId,
  type WebSearchSettings,
  type WebSearchKeySource,
} from '../definitions/webSearchConfig';
import { defaultKeySourceForEngine } from './defaultWebSearchKeySource';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWebSearchEngineId(value: unknown): value is WebSearchEngineId {
  return typeof value === 'string' && WEB_SEARCH_ENGINE_IDS.some((engine) => engine === value);
}

export function isWebSearchKeySource(value: unknown): value is WebSearchKeySource {
  return typeof value === 'string' && WEB_SEARCH_KEY_SOURCES.some((source) => source === value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function assertLegalCombination(engine: WebSearchEngineId, keySource: WebSearchKeySource): void {
  const legal = (() => {
    if (engine === 'parallel_free' || engine === 'duckduckgo' || engine === 'searxng') {
      return keySource === 'none';
    }
    return keySource === 'byok';
  })();
  if (!legal) {
    throw new WebSearchConfigurationError(
      'invalid_config',
      `搜索引擎 ${engine} 不支持 Key 来源 ${keySource}。`,
    );
  }
}

function normalizeSearxngBaseUrl(value: unknown): string {
  const raw = readOptionalString(value);
  if (!raw) {
    throw new WebSearchConfigurationError('invalid_config', 'SearXNG 需要填写自托管服务地址。');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebSearchConfigurationError('invalid_config', 'SearXNG 服务地址不是有效 URL。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebSearchConfigurationError('invalid_config', 'SearXNG 服务地址只支持 HTTP 或 HTTPS。');
  }
  return url.toString();
}

/** 把 IPC/磁盘中的未知输入归一为 Web 域唯一配置合同。 */
export function normalizeWebSearchConfig(value: unknown): WebSearchConfig {
  if (!isRecord(value) || !isWebSearchEngineId(value.engine) || !isWebSearchKeySource(value.keySource)) {
    throw new WebSearchConfigurationError('invalid_config', '网络搜索配置缺少有效的 engine 或 keySource。');
  }
  assertLegalCombination(value.engine, value.keySource);

  if (value.engine === 'searxng') {
    return {
      engine: value.engine,
      keySource: value.keySource,
      searxngBaseUrl: normalizeSearxngBaseUrl(value.searxngBaseUrl),
    };
  }

  if (value.keySource === 'byok') {
    const byokKey = readOptionalString(value.byokKey);
    return {
      engine: value.engine,
      keySource: value.keySource,
      ...(byokKey ? { byokKey } : {}),
    };
  }

  return { engine: value.engine, keySource: value.keySource };
}

/** 校验磁盘解密后的当前权威设置；每个槽位独立保留凭证。 */
export function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  if (!isRecord(value) || !isWebSearchEngineId(value.engine) || !isRecord(value.slots)) {
    throw new WebSearchConfigurationError('invalid_config', '网络搜索设置缺少有效的 engine 或 slots。');
  }
  const slots: Partial<Record<WebSearchEngineId, WebSearchCredentialSlot>> = {};
  for (const engine of WEB_SEARCH_ENGINE_IDS) {
    const rawSlot = value.slots[engine];
    if (rawSlot === undefined) continue;
    if (!isRecord(rawSlot)) {
      throw new WebSearchConfigurationError('invalid_config', `搜索引擎 ${engine} 的配置槽格式无效。`);
    }
    const keySource = rawSlot.keySource === undefined
      ? defaultKeySourceForEngine(engine)
      : rawSlot.keySource;
    const normalized = normalizeWebSearchConfig({
      engine,
      keySource,
      byokKey: rawSlot.byokKey,
      searxngBaseUrl: rawSlot.searxngBaseUrl,
    });
    const byokKey = readOptionalString(rawSlot.byokKey);
    slots[engine] = {
      keySource: normalized.keySource,
      ...(byokKey ? { byokKey } : {}),
      ...(normalized.searxngBaseUrl ? { searxngBaseUrl: normalized.searxngBaseUrl } : {}),
    };
  }
  if (!slots[value.engine]) {
    const activeConfig = normalizeWebSearchConfig({
      engine: value.engine,
      keySource: defaultKeySourceForEngine(value.engine),
    });
    slots[value.engine] = { keySource: activeConfig.keySource };
  }
  return { engine: value.engine, slots };
}

export function toWebSearchConfigView(settings: WebSearchSettings): WebSearchConfigView {
  const engines: WebSearchConfigView['engines'] = {};
  for (const engine of WEB_SEARCH_ENGINE_IDS) {
    const slot = settings.slots[engine];
    if (!slot) continue;
    engines[engine] = {
      keySource: slot.keySource ?? defaultKeySourceForEngine(engine),
      hasByokKey: typeof slot.byokKey === 'string' && slot.byokKey.length > 0,
      ...(slot.searxngBaseUrl ? { searxngBaseUrl: slot.searxngBaseUrl } : {}),
    };
  }
  return {
    engine: settings.engine,
    engines,
  };
}
