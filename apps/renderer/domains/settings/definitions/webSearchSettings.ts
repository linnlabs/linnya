import type { WebSearchEngineId } from '../../../../../src/tools/web/websearch/definitions/webSearchConfig';
import type { SettingsMessageKey } from './settingsMessages';

export interface WebSearchEnginePresentation {
  readonly id: WebSearchEngineId;
  readonly nameKey: SettingsMessageKey;
  readonly descriptionKey: SettingsMessageKey;
  readonly experimental?: boolean;
  readonly apiKeyUrl?: string;
}

export const WEB_SEARCH_ENGINE_PRESENTATIONS: readonly WebSearchEnginePresentation[] = [
  {
    id: 'parallel_free',
    nameKey: 'settings.webSearch.engine.parallelFree.name',
    descriptionKey: 'settings.webSearch.engine.parallelFree.description',
  },
  {
    id: 'duckduckgo',
    nameKey: 'settings.webSearch.engine.duckDuckGo.name',
    descriptionKey: 'settings.webSearch.engine.duckDuckGo.description',
    experimental: true,
  },
  {
    id: 'searxng',
    nameKey: 'settings.webSearch.engine.searxng.name',
    descriptionKey: 'settings.webSearch.engine.searxng.description',
  },
  {
    id: 'baidu_qianfan',
    nameKey: 'settings.webSearch.engine.baiduQianfan.name',
    descriptionKey: 'settings.webSearch.engine.baiduQianfan.description',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
  },
  {
    id: 'serper',
    nameKey: 'settings.webSearch.engine.serper.name',
    descriptionKey: 'settings.webSearch.engine.serper.description',
    apiKeyUrl: 'https://serper.dev/dashboard',
  },
  {
    id: 'jina_search',
    nameKey: 'settings.webSearch.engine.jinaSearch.name',
    descriptionKey: 'settings.webSearch.engine.jinaSearch.description',
    apiKeyUrl: 'https://jina.ai/api-dashboard/',
  },
  {
    id: 'tavily',
    nameKey: 'settings.webSearch.engine.tavily.name',
    descriptionKey: 'settings.webSearch.engine.tavily.description',
    apiKeyUrl: 'https://app.tavily.com/home',
  },
];

export function requiresWebSearchApiKey(engine: WebSearchEngineId): boolean {
  return engine === 'baidu_qianfan'
    || engine === 'serper'
    || engine === 'jina_search'
    || engine === 'tavily';
}
