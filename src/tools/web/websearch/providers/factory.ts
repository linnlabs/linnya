import { Logger } from '@shared/logger';
import {
  WebSearchConfigurationError,
  type WebSearchConfig,
  type WebSearchEngineId,
} from '../definitions/webSearchConfig';
import {
  WEB_SEARCH_SERVICE_DEFINITIONS,
  type WebSearchServiceRequest,
} from '../definitions/webSearchService';
import { getWebSearchConfig } from '../ports/webSearchConfigReader';
import { BaiduQianfanProvider } from './baiduQianfan';
import { DuckDuckGoProvider } from './duckDuckGo';
import { ParallelFreeProvider } from './parallelFree';
import { JinaSearchProvider } from './jina';
import { SearXNGProvider } from './searxng';
import { SerperProvider } from './serper';
import { TavilyProvider } from './tavily';
import type { WebSearchProvider } from './types';

const logger = new Logger('WebSearchProviderFactory');

type ByokWebSearchEngine = 'baidu_qianfan' | 'serper' | 'jina_search' | 'tavily';

function isByokEngine(engine: WebSearchEngineId): engine is ByokWebSearchEngine {
  return engine === 'baidu_qianfan'
    || engine === 'serper'
    || engine === 'jina_search'
    || engine === 'tavily';
}

export interface WebSearchProviderFactoryDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function createServiceRequest(params: {
  engine: WebSearchEngineId;
  baseUrl: string;
  apiKey?: string;
}): WebSearchServiceRequest {
  return {
    serviceId: params.engine,
    baseUrl: params.baseUrl,
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
  };
}

function createDirectProviderConfig(
  selection: WebSearchConfig,
  env: Readonly<Record<string, string | undefined>>,
): WebSearchServiceRequest {
  if (!isByokEngine(selection.engine)) {
    throw new WebSearchConfigurationError('invalid_config', `搜索引擎 ${selection.engine} 不支持 BYOK。`);
  }
  const definition = WEB_SEARCH_SERVICE_DEFINITIONS[selection.engine];
  const environmentVariable = definition.environmentVariable;
  const apiKey = selection.byokKey?.trim()
    || (environmentVariable ? env[environmentVariable]?.trim() : undefined);
  if (!apiKey) {
    throw new WebSearchConfigurationError(
      'missing_credentials',
      `${definition.displayName} API Key 未配置。请在网络搜索设置中填写 Key。`,
    );
  }
  return createServiceRequest({
    engine: selection.engine,
    baseUrl: definition.baseUrl,
    apiKey,
  });
}

/**
 * 按“调用方显式选择 > 已安装配置 > 产品默认”创建单一 Provider。
 * 请求失败由该 Provider 原样返回，工厂不会静默切换到其他引擎。
 */
export function createWebSearchProvider(
  explicitSelection?: WebSearchConfig,
  dependencies: WebSearchProviderFactoryDependencies = {},
): WebSearchProvider {
  const selection = explicitSelection ?? getWebSearchConfig();
  const environment = dependencies.environment ?? process.env;
  let config: WebSearchServiceRequest;

  if (selection.keySource === 'byok') {
    config = createDirectProviderConfig(selection, environment);
  } else {
    switch (selection.engine) {
      case 'parallel_free':
        config = createServiceRequest({ engine: selection.engine, baseUrl: '' });
        break;
      case 'duckduckgo':
        config = createServiceRequest({ engine: selection.engine, baseUrl: '' });
        break;
      case 'searxng':
        if (!selection.searxngBaseUrl) {
          throw new WebSearchConfigurationError('invalid_config', 'SearXNG 需要填写自托管服务地址。');
        }
        config = createServiceRequest({
          engine: selection.engine,
          baseUrl: selection.searxngBaseUrl,
        });
        break;
      default:
        throw new WebSearchConfigurationError(
          'invalid_config',
          `搜索引擎 ${selection.engine} 不支持无 Key 模式。`,
        );
    }
  }

  logger.info('[createWebSearchProvider] 选择 provider', {
    operation: 'search',
    engine: selection.engine,
    keySource: selection.keySource,
    serviceId: config.serviceId,
  });
  return createWebSearchProviderFromConfig(config);
}

export function createWebSearchProviderFromConfig(config: WebSearchServiceRequest): WebSearchProvider {
  switch (config.serviceId) {
    case 'baidu_qianfan':
      return new BaiduQianfanProvider(config);
    case 'serper':
      return new SerperProvider(config);
    case 'jina_search':
      return new JinaSearchProvider(config);
    case 'tavily':
      return new TavilyProvider(config);
    case 'parallel_free':
      return new ParallelFreeProvider(config);
    case 'duckduckgo':
      return new DuckDuckGoProvider(config);
    case 'searxng':
      return new SearXNGProvider(config);
    default:
      throw new WebSearchConfigurationError(
        'invalid_config',
        `不支持的 Web Search serviceId: "${config.serviceId}"。`,
      );
  }
}
