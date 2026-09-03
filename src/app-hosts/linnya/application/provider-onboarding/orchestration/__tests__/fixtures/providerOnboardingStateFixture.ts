import { vi } from 'vitest';

import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import type {
  ConfiguredProvider,
  PendingProviderModelRegistration,
} from 'src/domains/provider-configuration';

import type {
  ProviderOnboardingConfigurationPort,
  ProviderOnboardingModelCatalogPort,
} from '../../../definitions/providerOnboardingPorts';

/** 用真实归属顺序模拟跨 Model Catalog / Provider Configuration 的持久化状态。 */
export function createStatefulProviderOnboardingStorage() {
  let endpoints: InferenceEndpointView[] = [];
  let models: ModelConfig[] = [];
  let configuredProvider: ConfiguredProvider | undefined;
  let pendingIntent: PendingProviderModelRegistration | undefined;
  const catalog: ProviderOnboardingModelCatalogPort & {
    registerUserModel: ReturnType<typeof vi.fn>;
  } = {
    getModel: modelConfigId => models.find(model => model.id === modelConfigId),
    getInferenceEndpoints: () => endpoints,
    registerUserModel: vi.fn(async (model: ModelConfig, endpoint) => {
      const inferenceEndpointId =
        endpoint.kind === 'create' ? endpoint.endpoint.id : endpoint.inference_endpoint_id;
      models = [...models, { ...model, inference_endpoint_id: inferenceEndpointId }];
      if (endpoint.kind === 'create') {
        const credentialReference = endpoint.endpoint.credential_reference ?? { kind: 'none' };
        endpoints = [
          ...endpoints,
          {
            ...endpoint.endpoint,
            credential_reference: credentialReference,
            credential_status: credentialReference.kind === 'none' ? 'not_required' : 'configured',
          },
        ];
      }
    }),
    updateModel: vi.fn(async (model: ModelConfig) => {
      models = models.map(candidate => (candidate.id === model.id ? model : candidate));
    }),
  };
  const configurations: ProviderOnboardingConfigurationPort = {
    getByProviderConnectionDefinitionId: providerConnectionId =>
      configuredProvider?.provider_connection_definition_id === providerConnectionId
        ? configuredProvider
        : undefined,
    beginModelRegistration: vi.fn(async input => {
      pendingIntent = {
        id: input.intent_id,
        configured_provider_id: input.configured_provider_id,
        provider_definition_id: input.provider_definition_id,
        provider_connection_definition_id: input.provider_connection_definition_id,
        inference_endpoint_id: input.inference_endpoint_id,
        provider_model_id: input.provider_model_id,
        model_config_id: input.model_config_id,
      };
      return pendingIntent;
    }),
    completeModelRegistration: vi.fn(async intentId => {
      if (!pendingIntent || pendingIntent.id !== intentId) throw new Error('intent missing');
      const previousModels = configuredProvider?.models ?? [];
      configuredProvider = {
        id: pendingIntent.configured_provider_id,
        provider_definition_id: pendingIntent.provider_definition_id,
        provider_connection_definition_id: pendingIntent.provider_connection_definition_id,
        models: [
          ...previousModels,
          {
            provider_model_id: pendingIntent.provider_model_id,
            model_config_id: pendingIntent.model_config_id,
          },
        ],
      };
      pendingIntent = undefined;
    }),
    cancelModelRegistration: vi.fn(async () => {
      pendingIntent = undefined;
    }),
  };
  return {
    catalog,
    configurations,
    readEndpoints: () => endpoints,
    readModels: () => models,
    readConfiguredProvider: () => configuredProvider,
  };
}
