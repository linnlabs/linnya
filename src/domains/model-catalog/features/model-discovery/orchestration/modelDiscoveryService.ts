import {
  ModelDiscoveryRequestSchema,
  type ModelDiscoveryRequest,
  type ModelDiscoveryResponse,
} from '@app/schemas';
import type { ModelListingIdentity } from '../definitions/modelListingIdentity';
import type { ModelListingPage, ModelListingPageInput } from '../definitions/modelListingPage';
import {
  assertUniqueModelListingIdentities,
  parseModelIdentityListingPage,
} from '../functions/parseModelIdentityListingPage';
import { mergeDiscoveredModelPages } from '../functions/parseModelListingResponse';
import { ModelDiscoveryError } from '../definitions/modelDiscoveryError';
import { buildDiscoveryUrl } from '../functions/buildDiscoveryUrl';
import { parseModelListingPage } from '../functions/parseModelListingPage';

const DEFAULT_TIMEOUT_MS = 15_000;
export interface ModelDiscoveryServiceOptions {
  readonly fetchFn?: typeof fetch;
}

export class ModelDiscoveryService {
  private readonly fetchFn: typeof fetch;
  constructor(options: ModelDiscoveryServiceOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async discover(input: ModelDiscoveryRequest): Promise<ModelDiscoveryResponse> {
    return {
      models: mergeDiscoveredModelPages(await this.readListing(input, parseModelListingPage)),
    };
  }

  /** 正式 Provider 只复用成员查询，不能消费 Custom API 的推断容量。 */
  async listIdentities(
    input: ModelDiscoveryRequest,
    signal?: AbortSignal
  ): Promise<readonly ModelListingIdentity[]> {
    const models = await this.readListing(input, parseModelIdentityListingPage, signal);
    assertUniqueModelListingIdentities(models);
    return models;
  }

  private async readListing<Model extends { readonly id: string }>(
    input: ModelDiscoveryRequest,
    parsePage: (page: ModelListingPageInput) => ModelListingPage<Model>,
    signal?: AbortSignal
  ): Promise<Model[]> {
    const parsed = ModelDiscoveryRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new ModelDiscoveryError('model_discovery.invalid_request', '模型发现参数无效', 400);
    const request = parsed.data;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.api_format === 'anthropic_compatible') {
      headers['anthropic-version'] = '2023-06-01';
      if (request.api_key) headers['x-api-key'] = request.api_key;
    } else if (request.api_key) {
      headers.Authorization = `Bearer ${request.api_key}`;
    }
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const models: Model[] = [];
      const visitedAfterIds = new Set<string>();
      let afterId: string | undefined;
      while (true) {
        const url = buildDiscoveryUrl(request.base_url, request.api_format, afterId);
        // 所有页使用同一认证和期限，不跟随重定向或远端提供的 URL，避免凭据跨地址泄漏。
        const response = await this.fetchFn(url, {
          method: 'GET',
          headers,
          signal: requestSignal,
          redirect: 'error',
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new ModelDiscoveryError(
              'model_discovery.auth_failed',
              `端点鉴权失败 (${response.status})，请检查 API Key`,
              response.status
            );
          }
          throw new ModelDiscoveryError(
            'model_discovery.failed',
            `获取模型列表失败 (${response.status})`,
            response.status
          );
        }
        const body: unknown = await response.json();
        const page = parsePage({
          body,
          apiFormat: request.api_format,
          visitedAfterIds,
        });
        models.push(...page.models);
        // 调用方会用返回值删除缺失模型；只有全部分页成功才发布完整快照。
        if (page.nextAfterId === undefined) return models;
        afterId = page.nextAfterId;
        visitedAfterIds.add(afterId);
      }
    } catch (error: unknown) {
      if (error instanceof ModelDiscoveryError) throw error;
      if (signal?.aborted)
        throw new ModelDiscoveryError('model_discovery.network_error', '模型列表刷新已取消', 499);
      if (controller.signal.aborted)
        throw new ModelDiscoveryError(
          'model_discovery.network_error',
          '请求模型列表超时（15s）',
          504
        );
      if (error instanceof SyntaxError)
        throw new ModelDiscoveryError('model_discovery.failed', '模型服务返回的 JSON 无效', 502);
      // 不转发原始异常和响应正文：代理可能把认证头或密钥回显到错误中。
      throw new ModelDiscoveryError(
        'model_discovery.network_error',
        '无法连接到模型服务，请检查地址与网络',
        502
      );
    } finally {
      // 响应体也在超时范围内，收到 headers 不代表本次发现已完成。
      clearTimeout(timeout);
    }
  }
}
