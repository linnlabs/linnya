import { projectLiveProviderModelMetadata } from '@linnya/provider-catalog';
import { getProviderModelDiscoveryPolicy } from '@linnya/provider-catalog/runtime-bindings';
import { ModelDiscoveryService, ModelDiscoveryError } from 'src/domains/model-catalog';

import {
  ProviderModelDiscoveryError,
  type ProviderDiscoveredModel,
  type ProviderModelDiscovery,
  type ProviderModelDiscoveryRequest,
} from '../definitions/providerModelDiscovery';
import {
  completeOllamaModelMetadata,
  readDeepSeekModels,
  readOllamaModelIds,
  readOllamaModelMetadata,
} from '../functions/readProviderModelDiscovery';
import { completeListedProviderModels } from '../functions/completeListedProviderModels';

const REQUEST_TIMEOUT_MS = 15_000;
const OLLAMA_DETAILS_CONCURRENCY = 4;
const MODELS_DEV_URL = 'https://models.dev/api.json';

export interface CreateProviderModelDiscoveryDependencies {
  readonly fetchImplementation?: typeof fetch;
}

export function createProviderModelDiscovery(
  dependencies: CreateProviderModelDiscoveryDependencies = {}
): ProviderModelDiscovery {
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const modelListing = new ModelDiscoveryService({ fetchFn: fetchImplementation });
  const supports = (connectionId: string): boolean =>
    getProviderModelDiscoveryPolicy(connectionId) !== undefined;

  async function readJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetchImplementation(url, { ...init, signal: requestSignal });
      if (!response.ok) {
        throw new ProviderModelDiscoveryError(
          response.status === 401 || response.status === 403
            ? '供应商拒绝模型列表查询，请检查连接凭据'
            : `模型资料查询失败（HTTP ${response.status}）`,
          response.status
        );
      }
      // 超时信号覆盖完整响应体读取，不在收到 headers 后解除。
      return await response.json();
    } catch (error: unknown) {
      if (error instanceof ProviderModelDiscoveryError) throw error;
      if (signal.aborted) throw new ProviderModelDiscoveryError('模型列表刷新已取消', 499);
      if (timeout.aborted) throw new ProviderModelDiscoveryError('模型列表查询超时，请重试', 504);
      throw new ProviderModelDiscoveryError('无法读取供应商模型资料，请重试', 502);
    }
  }

  async function discoverListedModels(
    request: ProviderModelDiscoveryRequest,
    protocol: 'openai' | 'anthropic',
    requiresBundledModel: boolean,
    signal: AbortSignal
  ): Promise<readonly ProviderDiscoveredModel[]> {
    const models = await modelListing.listIdentities(
      {
        api_format: protocol === 'openai' ? 'openai_compatible' : 'anthropic_compatible',
        base_url: request.baseUrl,
        api_key: request.apiKey,
      },
      signal
    );
    const bundledIds = new Set(request.bundledModels.map(model => model.id));
    const needsMetadata = !requiresBundledModel && models.some(model => !bundledIds.has(model.id));
    const liveMetadata = needsMetadata
      ? projectLiveProviderModelMetadata(
          request.connectionId,
          // 元数据查询只接收公共请求头，不能带上供应商凭据。
          await readJson(MODELS_DEV_URL, { headers: { accept: 'application/json' } }, signal)
        )
      : [];
    return completeListedProviderModels(
      models,
      [...liveMetadata, ...request.bundledModels],
      request.bundledModels,
      requiresBundledModel
    );
  }

  async function discoverOllama(
    request: ProviderModelDiscoveryRequest,
    signal: AbortSignal
  ): Promise<readonly ProviderDiscoveredModel[]> {
    const baseUrl = request.baseUrl.replace(/\/+$/, '');
    const headers = { accept: 'application/json', authorization: `Bearer ${request.apiKey}` };
    const ids = readOllamaModelIds(await readJson(`${baseUrl}/api/tags`, { headers }, signal));
    const details: ReturnType<typeof readOllamaModelMetadata>[] = [];
    // 少量并发请求保持列表顺序，也避免模型较多时把供应商同时打满。
    for (let offset = 0; offset < ids.length; offset += OLLAMA_DETAILS_CONCURRENCY) {
      const batch = ids.slice(offset, offset + OLLAMA_DETAILS_CONCURRENCY);
      details.push(
        ...(await Promise.all(
          batch.map(async id =>
            readOllamaModelMetadata(
              id,
              await readJson(
                `${baseUrl}/api/show`,
                {
                  method: 'POST',
                  headers: { ...headers, 'content-type': 'application/json' },
                  body: JSON.stringify({ model: id }),
                },
                signal
              )
            )
          )
        ))
      );
    }
    const bundled = new Map(request.bundledModels.map(model => [model.id, model]));
    const needsNewMetadata = details.some(model => !('status' in model) && !bundled.has(model.id));
    const liveMetadata = needsNewMetadata
      ? projectLiveProviderModelMetadata(
          request.connectionId,
          // 公共资料站永远收不到供应商 API Key。
          await readJson(MODELS_DEV_URL, { headers: { accept: 'application/json' } }, signal)
        )
      : [];
    const metadata = new Map(
      [...liveMetadata, ...request.bundledModels].map(model => [model.id, model])
    );
    return details.map(model =>
      'status' in model ? model : completeOllamaModelMetadata(model, metadata.get(model.id))
    );
  }

  return {
    supports,
    async discover(request) {
      const policy = getProviderModelDiscoveryPolicy(request.connectionId);
      if (!policy) {
        throw new ProviderModelDiscoveryError('该供应商尚不支持实时模型发现', 400);
      }
      const cancellation = new AbortController();
      const signal = AbortSignal.any([
        cancellation.signal,
        ...(request.signal ? [request.signal] : []),
      ]);
      try {
        if (signal.aborted) throw new ProviderModelDiscoveryError('模型列表刷新已取消', 499);
        if (policy.protocol === 'openai' || policy.protocol === 'anthropic') {
          return await discoverListedModels(
            request,
            policy.protocol,
            policy.requires_bundled_model === true,
            signal
          );
        }
        if (policy.protocol === 'deepseek') {
          return readDeepSeekModels(
            await readJson(
              `${request.baseUrl.replace(/\/+$/, '')}/models`,
              {
                headers: { accept: 'application/json', authorization: `Bearer ${request.apiKey}` },
              },
              signal
            )
          );
        }
        return await discoverOllama(request, signal);
      } catch (error: unknown) {
        cancellation.abort();
        if (error instanceof ProviderModelDiscoveryError) throw error;
        if (error instanceof ModelDiscoveryError) {
          throw new ProviderModelDiscoveryError(error.message, error.statusCode);
        }
        throw new ProviderModelDiscoveryError('供应商模型资料未通过准入，请稍后重试', 502);
      }
    },
  };
}
