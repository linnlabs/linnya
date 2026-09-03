import { randomUUID } from 'node:crypto';
import type { ModelConfig } from 'src/domains/model-catalog';
import { modelCatalog as defaultCatalog } from 'src/domains/model-catalog';
import {
  ImageGenerationFailure,
  resolveImageGenerationSize,
  type ImageGenerationPort,
  validateImageGenerationRequest,
  validateImageGenerationResult,
} from 'src/domains/image-generation';
import {
  beginProviderOutboundAttempt,
  defaultProviderOutboundAudit,
  type ProviderOutboundAuditPort,
} from 'src/domains/audit/features/provider-outbound-audit';
import { generateImageWithAiSdk } from '../capabilities/ai-sdk/orchestration/generateImageWithAiSdk';
import { classifyImageGenerationFailure } from '../capabilities/ai-sdk/functions/classifyImageGenerationFailure';
import {
  createDefaultModelRequestCredentialResolver,
  ModelRequestCredentialError,
  type ModelRequestCredential,
  type ModelRequestCredentialResolver,
} from '../../model-request-auth';

export interface ImageGenerationModelCatalog {
  initialize(): Promise<void>;
  getModel(id: string): ModelConfig | undefined;
}

export interface CreateImageGenerationPortDependencies {
  readonly catalog?: ImageGenerationModelCatalog;
  readonly credentialResolver?: ModelRequestCredentialResolver;
  readonly invoke?: typeof generateImageWithAiSdk;
  readonly outbound_audit?: ProviderOutboundAuditPort;
}

export function createImageGenerationPort(
  dependencies: CreateImageGenerationPortDependencies = {}
): ImageGenerationPort {
  const catalog: ImageGenerationModelCatalog = dependencies.catalog ?? defaultCatalog;
  const credentialResolver =
    dependencies.credentialResolver ?? createDefaultModelRequestCredentialResolver();
  const invoke = dependencies.invoke ?? generateImageWithAiSdk;
  const outboundAudit = dependencies.outbound_audit ?? defaultProviderOutboundAudit;
  return {
    async generate(request) {
      validateImageGenerationRequest(request);
      await catalog.initialize();
      const model = catalog.getModel(request.modelId);
      if (!model) {
        throw new ImageGenerationFailure(
          'protocol',
          'model_not_found',
          false,
          `图片生成模型 '${request.modelId}' 不存在`
        );
      }
      const route = model.image_generation_route;
      if (!route) {
        throw new ImageGenerationFailure(
          'protocol',
          'route_missing',
          false,
          `图片生成模型 '${request.modelId}' 缺少 image_generation_route`
        );
      }
      const size = resolveImageGenerationSize(request.size, model.image_generation);
      let credential: ModelRequestCredential | undefined;
      if (route.auth_profile === 'bearer') {
        try {
          credential = await credentialResolver.resolve({
            model_id: request.modelId,
            endpoint_id: route.endpoint_id,
            auth_profile: route.auth_profile,
          });
        } catch (error: unknown) {
          if (!(error instanceof ModelRequestCredentialError)) throw error;
          throw new ImageGenerationFailure(
            'protocol',
            'credential_missing',
            false,
            `图片生成模型 '${request.modelId}' 缺少凭据`
          );
        }
        if (credential.profile !== route.auth_profile || !credential.secret.trim()) {
          throw new ImageGenerationFailure(
            'protocol',
            'credential_missing',
            false,
            `图片生成模型 '${request.modelId}' 缺少凭据`
          );
        }
      }

      const attempt = beginProviderOutboundAttempt(outboundAudit, {
        attempt_id: randomUUID(),
        operation: 'image_generation',
        route: {
          model_id: request.modelId,
          endpoint_id: route.endpoint_id,
          endpoint_model_id: route.endpoint_model_id,
          api_surface: route.api_surface,
          capability_id: route.capability_id,
        },
        input: { kind: 'image_generation', requested_image_count: request.count },
      });
      try {
        const result = await invoke(
          {
            providerId: route.endpoint_id,
            providerModelId: route.endpoint_model_id,
            baseUrl: route.base_url,
            ...(credential
              ? {
                  apiKey: credential.secret,
                  ...(credential.request_headers ? { headers: credential.request_headers } : {}),
                }
              : {}),
            responseFormat: route.response_format,
            maxImagesPerCall: route.max_images_per_call,
          },
          { ...request, size }
        );
        validateImageGenerationResult(request.count, result);
        attempt.succeed({
          finish_reason: 'completed',
          usage: { provenance: 'not_reported' },
        });
        return result;
      } catch (error) {
        const failure =
          error instanceof ImageGenerationFailure
            ? error
            : classifyImageGenerationFailure(error, request.signal);
        attempt.fail({
          usage: { provenance: 'not_reported' },
          failure: {
            kind: failure.kind,
            code: failure.code,
            retryable: failure.retryable,
          },
        });
        if (error instanceof ImageGenerationFailure) throw error;
        throw new ImageGenerationFailure(
          failure.kind,
          failure.code,
          failure.retryable,
          `图片生成 Provider 调用失败：${failure.code}`
        );
      }
    },
  };
}
