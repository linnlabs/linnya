import type {
  WebSearchEngineId,
  WebSearchKeySource,
} from '../definitions/webSearchConfig';

/** 付费搜索服务由用户直接配置 Key；免费与自托管引擎无需 Key。 */
export function defaultKeySourceForEngine(engine: WebSearchEngineId): WebSearchKeySource {
  if (
    engine === 'baidu_qianfan'
    || engine === 'serper'
    || engine === 'jina_search'
    || engine === 'tavily'
  ) return 'byok';
  return 'none';
}
