import { randomUUID } from 'node:crypto';
import type { ModelConfig } from 'src/domains/model-catalog';
import { modelCatalog as defaultCatalog } from 'src/domains/model-catalog';
import {
  beginProviderOutboundAttempt,
  defaultProviderOutboundDiagnostics,
  type ProviderOutboundDiagnosticsPort,
} from 'src/domains/provider-diagnostics/features/provider-outbound';
import {
  orderRerankingItems,
  RerankingFailure,
  type RerankingPort,
  validateRerankingResult,
} from 'src/domains/model-inference';
import { classifyAiSdkFailure } from '@linnlabs/linnkit-provider-ai-sdk';
import { rerankWithAiSdk } from '../capabilities/ai-sdk/orchestration/rerankWithAiSdk';

export interface RerankingModelCatalog {
  initialize(): Promise<void>;
  getModel(id: string): ModelConfig | undefined;
  resolveCredential(modelId: string): string | undefined;
}

export interface CreateRerankingPortDependencies {
  readonly catalog?: RerankingModelCatalog;
  readonly invoke?: typeof rerankWithAiSdk;
  readonly outbound_diagnostics?: ProviderOutboundDiagnosticsPort;
}

export function createRerankingPort(
  dependencies: CreateRerankingPortDependencies = {}
): RerankingPort {
  const catalog = dependencies.catalog ?? defaultCatalog;
  const invoke = dependencies.invoke ?? rerankWithAiSdk;
  const outboundDiagnostics = dependencies.outbound_diagnostics ?? defaultProviderOutboundDiagnostics;
  return {
    async rerank(request) {
      await catalog.initialize();
      const model = catalog.getModel(request.modelId);
      if (!model) {
        throw new RerankingFailure(
          'protocol',
          'model_not_found',
          false,
          `Reranking 模型 '${request.modelId}' 不存在`
        );
      }
      const route = model.reranking_route;
      if (!route) {
        throw new RerankingFailure(
          'protocol',
          'route_missing',
          false,
          `Reranking 模型 '${request.modelId}' 缺少 reranking_route`
        );
      }
      const credential = catalog.resolveCredential(request.modelId);
      if (!credential) {
        throw new RerankingFailure(
          'protocol',
          'credential_missing',
          false,
          `Reranking 模型 '${request.modelId}' 缺少凭据`
        );
      }
      const attempt = beginProviderOutboundAttempt(outboundDiagnostics, {
        attempt_id: randomUUID(),
        operation: 'reranking',
        route: {
          model_id: request.modelId,
          endpoint_id: route.endpoint_id,
          endpoint_model_id: route.endpoint_model_id,
          api_surface: route.api_surface,
          capability_id: route.capability_id,
        },
        input: {
          kind: 'reranking',
          document_count: request.documents.length,
          ...(request.topN === undefined ? {} : { requested_top_n: request.topN }),
        },
      });
      try {
        const result = await invoke(
          {
            providerModelId: route.endpoint_model_id,
            baseUrl: route.base_url,
            apiKey: credential,
          },
          request
        );
        validateRerankingResult(request.documents.length, result.ranking);
        attempt.succeed({
          finish_reason: 'completed',
          usage: result.usage
            ? {
                provenance: 'provider_reported',
                ...(result.usage.inputTokens === undefined
                  ? {}
                  : { input_tokens: result.usage.inputTokens }),
              }
            : { provenance: 'not_reported' },
        });
        return { ...result, ranking: orderRerankingItems(result.ranking) };
      } catch (error) {
        const failure =
          error instanceof RerankingFailure ? error : classifyAiSdkFailure(error, request.signal);
        attempt.fail({
          usage: { provenance: 'not_reported' },
          failure: {
            kind: failure.kind,
            code: failure.code,
            retryable: failure.retryable,
          },
        });
        if (error instanceof RerankingFailure) throw error;
        throw new RerankingFailure(
          failure.kind,
          failure.code,
          failure.retryable,
          `Reranking Provider 调用失败：${failure.code}`
        );
      }
    },
  };
}
