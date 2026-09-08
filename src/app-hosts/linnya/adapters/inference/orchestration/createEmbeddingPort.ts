import { randomUUID } from 'node:crypto';
import type { ModelConfig } from 'src/domains/model-catalog';
import { modelCatalog as defaultCatalog } from 'src/domains/model-catalog';
import {
  EmbeddingFailure,
  type EmbeddingPort,
  validateEmbeddingResult,
} from 'src/domains/model-inference';
import {
  beginProviderOutboundAttempt,
  defaultProviderOutboundDiagnostics,
  type ProviderOutboundDiagnosticsPort,
} from 'src/domains/provider-diagnostics/features/provider-outbound';
import { embedWithAiSdk } from '../capabilities/ai-sdk/orchestration/embedWithAiSdk';
import { classifyAiSdkFailure } from '@linnlabs/linnkit-provider-ai-sdk';

export interface EmbeddingModelCatalog {
  initialize(): Promise<void>;
  getModel(id: string): ModelConfig | undefined;
  resolveCredential(modelId: string): string | undefined;
}

export interface CreateEmbeddingPortDependencies {
  readonly catalog?: EmbeddingModelCatalog;
  readonly invoke?: typeof embedWithAiSdk;
  readonly outbound_diagnostics?: ProviderOutboundDiagnosticsPort;
}

export function createEmbeddingPort(
  dependencies: CreateEmbeddingPortDependencies = {}
): EmbeddingPort {
  const catalog = dependencies.catalog ?? defaultCatalog;
  const invoke = dependencies.invoke ?? embedWithAiSdk;
  const outboundDiagnostics = dependencies.outbound_diagnostics ?? defaultProviderOutboundDiagnostics;
  return {
    async embed(request) {
      await catalog.initialize();
      const model = catalog.getModel(request.modelId);
      if (!model) {
        throw new EmbeddingFailure(
          'protocol',
          'model_not_found',
          false,
          `Embedding 模型 '${request.modelId}' 不存在`
        );
      }
      const route = model.embedding_route;
      if (!route) {
        throw new EmbeddingFailure(
          'protocol',
          'route_missing',
          false,
          `Embedding 模型 '${request.modelId}' 缺少 embedding_route`
        );
      }
      const credential = catalog.resolveCredential(request.modelId);
      if (route.auth_profile === 'bearer' && !credential) {
        throw new EmbeddingFailure(
          'protocol',
          'credential_missing',
          false,
          `Embedding 模型 '${request.modelId}' 缺少凭据`
        );
      }
      const attempt = beginProviderOutboundAttempt(outboundDiagnostics, {
        attempt_id: randomUUID(),
        operation: 'embedding',
        route: {
          model_id: request.modelId,
          endpoint_id: route.endpoint_id,
          endpoint_model_id: route.endpoint_model_id,
          api_surface: route.api_surface,
          capability_id: route.capability_id,
        },
        input: { kind: 'embedding', value_count: request.values.length },
      });
      try {
        const result = await invoke(
          {
            providerId: route.endpoint_id,
            providerModelId: route.endpoint_model_id,
            baseUrl: route.base_url,
            ...(route.auth_profile === 'bearer' ? { apiKey: credential } : {}),
          },
          request
        );
        validateEmbeddingResult(request.values, result.vectors);
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
        return result;
      } catch (error) {
        const failure =
          error instanceof EmbeddingFailure ? error : classifyAiSdkFailure(error, request.signal);
        attempt.fail({
          usage: { provenance: 'not_reported' },
          failure: {
            kind: failure.kind,
            code: failure.code,
            retryable: failure.retryable,
          },
        });
        if (error instanceof EmbeddingFailure) throw error;
        throw new EmbeddingFailure(
          failure.kind,
          failure.code,
          failure.retryable,
          `Embedding Provider 调用失败：${failure.code}`
        );
      }
    },
  };
}
