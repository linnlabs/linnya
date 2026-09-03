export const WEB_SEARCH_ENGINE_IDS = [
  'parallel_free',
  'duckduckgo',
  'searxng',
  'baidu_qianfan',
  'serper',
  'jina_search',
  'tavily',
] as const;

export type WebSearchEngineId = (typeof WEB_SEARCH_ENGINE_IDS)[number];

export const WEB_SEARCH_KEY_SOURCES = ['none', 'byok'] as const;

export type WebSearchKeySource = (typeof WEB_SEARCH_KEY_SOURCES)[number];

/** Web 域内部使用的完整配置；BYOK Key 不得通过 get IPC 回传 renderer。 */
export interface WebSearchConfig {
  readonly engine: WebSearchEngineId;
  readonly keySource: WebSearchKeySource;
  readonly byokKey?: string;
  readonly searxngBaseUrl?: string;
}

/** 单个搜索引擎的持久化槽位；切换引擎不得覆盖其他槽位。 */
export interface WebSearchCredentialSlot {
  readonly keySource?: WebSearchKeySource;
  readonly byokKey?: string;
  readonly searxngBaseUrl?: string;
}

/** Web 搜索配置的域内权威结构。 */
export interface WebSearchSettings {
  readonly engine: WebSearchEngineId;
  readonly slots: Partial<Record<WebSearchEngineId, WebSearchCredentialSlot>>;
}

export interface WebSearchEngineConfigView {
  readonly keySource: WebSearchKeySource;
  readonly hasByokKey: boolean;
  readonly searxngBaseUrl?: string;
}

/** Renderer 可读取的配置视图，只按引擎暴露凭证是否存在。 */
export interface WebSearchConfigView {
  readonly engine: WebSearchEngineId;
  readonly engines: Partial<Record<WebSearchEngineId, WebSearchEngineConfigView>>;
}

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = Object.freeze({
  engine: 'parallel_free',
  keySource: 'none',
});

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = Object.freeze({
  engine: 'parallel_free',
  slots: Object.freeze({
    parallel_free: Object.freeze({ keySource: 'none' }),
  }),
});

export type WebSearchConfigurationErrorCode = 'invalid_config' | 'missing_credentials';

export class WebSearchConfigurationError extends Error {
  readonly name = 'WebSearchConfigurationError';

  constructor(
    readonly code: WebSearchConfigurationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
