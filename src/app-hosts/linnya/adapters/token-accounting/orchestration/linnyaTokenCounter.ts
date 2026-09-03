import type { TokenRoute } from '@linnlabs/linnkit/contracts';
import type { LlmRequestMessage, TokenCounterPort, TokenCountResult } from '@linnlabs/linnkit/ports';
import type { ModelCatalog, ModelConfig } from 'src/domains/model-catalog';
import { modelCatalog } from 'src/domains/model-catalog';
import {
  createDefaultModelRequestCredentialResolver,
  type ModelRequestCredential,
  type ModelRequestCredentialResolver,
} from '../../model-request-auth';
import type { TokenCountCapability } from '../definitions/tokenCountCapability';
import { resolveDefaultTokenCountCapability } from '../registry/defaultTokenCountCapabilityRegistry';

type FetchLike = typeof fetch;

export interface LinnyaTokenCounterOptions {
  readonly catalog?: Pick<ModelCatalog, 'getModel'>;
  readonly credentialResolver?: ModelRequestCredentialResolver;
  readonly fetchImpl?: FetchLike;
  readonly resolveCapability?: (capabilityId: string) => TokenCountCapability;
}

/**
 * Host 侧 route-aware remote token counter。
 *
 * route.capabilityId 只选择已注册且核验过的 count surface，baseURL 始终来自当前 route；
 * 因此中转或未来 Cloud gateway 不会被偷偷改发到厂商官网。
 */
export class LinnyaTokenCounter implements TokenCounterPort {
  private readonly catalog: Pick<ModelCatalog, 'getModel'>;
  private readonly credentialResolver: ModelRequestCredentialResolver;
  private readonly fetchImpl: FetchLike;
  private readonly resolveCapability: (capabilityId: string) => TokenCountCapability;

  constructor(options: LinnyaTokenCounterOptions = {}) {
    this.catalog = options.catalog ?? modelCatalog;
    this.credentialResolver =
      options.credentialResolver ?? createDefaultModelRequestCredentialResolver();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveCapability = options.resolveCapability ?? resolveDefaultTokenCountCapability;
  }

  async countMessages(input: {
    route: TokenRoute;
    messages: LlmRequestMessage[];
    tools?: unknown;
    signal?: AbortSignal;
  }): Promise<TokenCountResult> {
    if (input.route.capabilities?.supportsRemoteTokenCount !== true) {
      throw new Error(
        `[TokenAccounting] route ${input.route.modelId} 未声明 supportsRemoteTokenCount。`
      );
    }

    const model = this.resolveModel(input.route);
    const capability = this.resolveCapability(input.route.capabilityId);
    const baseURL = input.route.baseURL;
    if (!baseURL) throw new Error(`[TokenAccounting] route ${input.route.modelId} 缺少 baseURL。`);
    const credential = await this.resolveCredential(model);
    const request = capability.buildRequest({
      route: input.route,
      credential,
      baseURL,
      endpointModelId: input.route.endpointModelId ?? model.model_name,
      messages: input.messages,
      ...(input.tools !== undefined ? { tools: input.tools } : {}),
    });

    const response = await this.fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `[TokenAccounting] token count failed: ${response.status} ${response.statusText}`
      );
    }
    const raw = parseJsonResponse(responseText);
    return {
      inputTokens: capability.readInputTokens(raw),
      source: 'provider-preflight-count',
      confidence: 'provider-estimate',
      raw,
    };
  }

  private resolveModel(route: TokenRoute): ModelConfig {
    const model = this.catalog.getModel(route.modelId);
    if (!model)
      throw new Error(`[TokenAccounting] 找不到 route.modelId=${route.modelId} 对应的模型配置。`);
    return model;
  }

  private async resolveCredential(model: ModelConfig): Promise<ModelRequestCredential | undefined> {
    const route = model.inference_route;
    if (!route) {
      throw new Error(`[TokenAccounting] 模型 ${model.id} 缺少 inference_route 认证合同。`);
    }
    if (route.auth_profile === 'none') return undefined;
    return this.credentialResolver.resolve({
      model_id: model.id,
      endpoint_id: route.endpoint_id,
      auth_profile: route.auth_profile,
    });
  }
}

export function createDefaultLinnyaTokenCounter(): LinnyaTokenCounter {
  return new LinnyaTokenCounter();
}

function parseJsonResponse(text: string): unknown {
  if (!text.trim()) throw new Error('[TokenAccounting] token count response body 为空。');
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[TokenAccounting] token count response 不是合法 JSON：${reason}`);
  }
}
