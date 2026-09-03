import { findLanguageInferenceRouteProfile } from '@app/schemas/model-inference';
import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import type { ConfiguredProvider } from 'src/domains/provider-configuration';
import type { ProviderDefinition } from '@linnya/provider-catalog';
import type { ProviderOnboardingRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';

export interface ProjectLegacyFormalProviderConfigurationsInput {
  readonly providers: readonly ProviderDefinition[];
  readonly bindings: {
    get(providerDefinitionId: string): ProviderOnboardingRuntimeBinding | undefined;
  };
  readonly models: readonly ModelConfig[];
  readonly endpoints: readonly InferenceEndpointView[];
  readonly createId: () => string;
}

export interface LegacyFormalProviderConfigurationProjection {
  readonly configuredProviders: readonly ConfiguredProvider[];
  readonly skippedProviderIds: readonly string[];
}

interface LegacyProviderModelAssociation {
  readonly provider_model_id: string;
  readonly model_config_id: string;
  readonly endpoint_id: string;
}

function isHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isExactLegacyOllamaModel(model: ModelConfig, endpoint: InferenceEndpointView): boolean {
  const route = model.inference_route;
  return (
    model.catalog_source === 'user' &&
    model.inference_endpoint_id === endpoint.id &&
    Boolean(route) &&
    isHttpBaseUrl(route?.base_url ?? '') &&
    endpoint.route_profile_id === 'openai_compatible_chat' &&
    endpoint.endpoint_id === 'ollama' &&
    endpoint.base_url === route?.base_url &&
    endpoint.auth_profile === 'none' &&
    endpoint.credential_status === 'not_required' &&
    route?.api_surface === 'openai_chat_completions' &&
    route.capability_id === 'ai-sdk:openai-compatible' &&
    route.endpoint_id === 'ollama' &&
    route.endpoint_model_id === model.model_name &&
    route.base_url === endpoint.base_url &&
    route.auth_profile === 'none' &&
    route.input_support.user_image === false &&
    route.input_support.tool_result_image === false &&
    route.continuation.tool_replay === 'unavailable'
  );
}

function createConfiguredProvider(
  providerDefinitionId: string,
  providerConnectionDefinitionId: string,
  associations: readonly LegacyProviderModelAssociation[],
  createId: () => string
): ConfiguredProvider | 'ambiguous' | undefined {
  if (associations.length === 0) return undefined;
  const endpointIds = new Set(associations.map(association => association.endpoint_id));
  const providerModelIds = new Set(associations.map(association => association.provider_model_id));
  if (endpointIds.size !== 1 || providerModelIds.size !== associations.length) return 'ambiguous';
  return {
    id: createId(),
    provider_definition_id: providerDefinitionId,
    provider_connection_definition_id: providerConnectionDefinitionId,
    models: associations.map(({ provider_model_id, model_config_id }) => ({
      provider_model_id,
      model_config_id,
    })),
  };
}

function isExactLegacyFormalModel(
  model: ModelConfig,
  endpoint: InferenceEndpointView,
  providerModelId: string,
  binding: ProviderOnboardingRuntimeBinding
): boolean {
  const route = model.inference_route;
  if (!route) return false;
  const profile = findLanguageInferenceRouteProfile(binding.default_route_profile_id);
  return (
    model.catalog_source === 'user' &&
    model.inference_endpoint_id === endpoint.id &&
    model.model_name === providerModelId &&
    route.base_url === binding.default_base_url &&
    endpoint.route_profile_id === binding.default_route_profile_id &&
    endpoint.endpoint_id.startsWith(`${binding.endpoint_id}:`) &&
    endpoint.base_url === binding.default_base_url &&
    endpoint.auth_profile === binding.auth_profile &&
    route.api_surface === profile.api_surface &&
    route.capability_id === profile.capability_id &&
    route.endpoint_id === endpoint.endpoint_id &&
    route.endpoint_model_id === providerModelId &&
    route.base_url === binding.default_base_url &&
    route.auth_profile === binding.auth_profile
  );
}

/**
 * 只迁移旧正式 onboarding 能唯一证明的身份。URL 相同、模型名相同或协议相同都不足以单独认领；
 * 有多个 endpoint 或同一目录模型重复时跳过该 Provider，保留原 Model Catalog 数据不动。
 */
export function projectLegacyFormalProviderConfigurations(
  input: ProjectLegacyFormalProviderConfigurationsInput
): LegacyFormalProviderConfigurationProjection {
  const configuredProviders: ConfiguredProvider[] = [];
  const skippedProviderIds: string[] = [];

  for (const provider of input.providers) {
    for (const connection of provider.connections) {
      if (
        connection.id === 'ollama' &&
        connection.kind === 'local_runtime' &&
        connection.model_discovery === 'local_runtime'
      ) {
        const associations = input.models.flatMap(model => {
          const endpoint = model.inference_endpoint_id
            ? input.endpoints.find(candidate => candidate.id === model.inference_endpoint_id)
            : undefined;
          return endpoint && isExactLegacyOllamaModel(model, endpoint)
            ? [
                {
                  provider_model_id: model.model_name,
                  model_config_id: model.id,
                  endpoint_id: endpoint.id,
                },
              ]
            : [];
        });
        const configuredProvider = createConfiguredProvider(
          provider.id,
          connection.id,
          associations,
          input.createId
        );
        if (configuredProvider === 'ambiguous') skippedProviderIds.push(connection.id);
        else if (configuredProvider) configuredProviders.push(configuredProvider);
        continue;
      }
      if (connection.kind !== 'direct' || connection.model_discovery !== 'bundled') continue;
      const binding = input.bindings.get(connection.id);
      if (!binding) continue;
      const associations = input.models.flatMap(model => {
        const providerModel = connection.models.find(
          candidate => candidate.id === model.model_name
        );
        const endpoint = model.inference_endpoint_id
          ? input.endpoints.find(candidate => candidate.id === model.inference_endpoint_id)
          : undefined;
        return providerModel &&
          endpoint &&
          isExactLegacyFormalModel(model, endpoint, providerModel.id, binding)
          ? [
              {
                provider_model_id: providerModel.id,
                model_config_id: model.id,
                endpoint_id: endpoint.id,
              },
            ]
          : [];
      });
      const configuredProvider = createConfiguredProvider(
        provider.id,
        connection.id,
        associations,
        input.createId
      );
      if (configuredProvider === 'ambiguous') skippedProviderIds.push(connection.id);
      else if (configuredProvider) configuredProviders.push(configuredProvider);
    }
  }

  return { configuredProviders, skippedProviderIds };
}
