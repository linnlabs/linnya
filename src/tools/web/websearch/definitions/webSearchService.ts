import type { WebSearchEngineId } from './webSearchConfig';

export interface WebSearchServiceDefinition {
  readonly id: WebSearchEngineId;
  readonly baseUrl: string;
  readonly environmentVariable?: string;
  readonly displayName: string;
}

/** 单次搜索调用所需的 Web-owned 外部服务配置。 */
export interface WebSearchServiceRequest {
  readonly serviceId: WebSearchEngineId;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export const WEB_SEARCH_SERVICE_DEFINITIONS: Readonly<
  Record<WebSearchEngineId, WebSearchServiceDefinition>
> = Object.freeze({
  parallel_free: Object.freeze({
    id: 'parallel_free',
    baseUrl: '',
    displayName: 'Parallel Free',
  }),
  duckduckgo: Object.freeze({
    id: 'duckduckgo',
    baseUrl: '',
    displayName: 'DuckDuckGo',
  }),
  searxng: Object.freeze({
    id: 'searxng',
    baseUrl: '',
    displayName: 'SearXNG',
  }),
  baidu_qianfan: Object.freeze({
    id: 'baidu_qianfan',
    // 百度 adapter 会在版本根路径后拼接 ai_search/web_search。
    baseUrl: 'https://qianfan.baidubce.com/v2/',
    environmentVariable: 'BAIDU_SEARCH_API_KEY',
    displayName: '百度千帆',
  }),
  serper: Object.freeze({
    id: 'serper',
    baseUrl: 'https://google.serper.dev',
    environmentVariable: 'SERPER_API_KEY',
    displayName: 'Serper',
  }),
  jina_search: Object.freeze({
    id: 'jina_search',
    baseUrl: 'https://s.jina.ai/',
    environmentVariable: 'JINA_API_KEY',
    displayName: 'Jina Search',
  }),
  tavily: Object.freeze({
    id: 'tavily',
    baseUrl: 'https://api.tavily.com',
    environmentVariable: 'TAVILY_API_KEY',
    displayName: 'Tavily',
  }),
});
