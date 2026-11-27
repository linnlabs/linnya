import { vi } from 'vitest';

import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
  UnadmittedUserModel,
} from 'src/domains/model-catalog';
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
  let unadmittedModels: UnadmittedUserModel[] = [];
  let configuredProvider: ConfiguredProvider | undefined;
  let pendingIntent: PendingProviderModelRegistration | undefined;
  const commitModel = (model: ModelConfig, endpoint: InferenceEndpointSelection) => {
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
  };
  const catalog: ProviderOnboardingModelCatalogPort & {
    registerUserModel: ReturnType<typeof vi.fn>;
    replaceUnadmittedUserModel: ReturnType<typeof vi.fn>;
    replaceInferenceEndpointCredential: ReturnType<typeof vi.fn>;
  } = {
    getModel: modelConfigId => models.find(model => model.id === modelConfigId),
    getUnadmittedUserModels: () => unadmittedModels,
    getInferenceEndpoints: () => endpoints,
    registerUserModel: vi.fn(async (model: ModelConfig, endpoint: InferenceEndpointSelection) => {
      commitModel(model, endpoint);
    }),
    // 与 Model Catalog 同一合同：只替换同 ID 的停用条目，不覆盖已准入模型。
    replaceUnadmittedUserModel: vi.fn(
      async (model: ModelConfig, endpoint: InferenceEndpointSelection) => {
        if (!unadmittedModels.some(entry => entry.id === model.id)) {
          throw new Error(`停用的用户模型不存在: ${model.id}`);
        }
        unadmittedModels = unadmittedModels.filter(entry => entry.id !== model.id);
        commitModel(model, endpoint);
      }
    ),
    updateModel: vi.fn(async (model: ModelConfig) => {
      models = models.map(candidate => (candidate.id === model.id ? model : candidate));
    }),
    replaceInferenceEndpointCredential: vi.fn(async (inferenceEndpointId: string) => {
      const target = endpoints.find(endpoint => endpoint.id === inferenceEndpointId);
      if (!target) throw new Error(`InferenceEndpoint 不存在: ${inferenceEndpointId}`);
      endpoints = endpoints.map(endpoint =>
        JSON.stringify(endpoint.credential_reference) ===
        JSON.stringify(target.credential_reference)
          ? { ...endpoint, credential_status: 'configured' }
          : endpoint
      );
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
    /** 模拟重启时这条模型没有通过准入：离开运行目录、进入停用列表，Provider 归属保持不变。 */
    disableAtRestart(modelConfigId: string) {
      const model = models.find(candidate => candidate.id === modelConfigId);
      if (!model) throw new Error(`fixture model missing: ${modelConfigId}`);
      models = models.filter(candidate => candidate.id !== modelConfigId);
      unadmittedModels = [
        ...unadmittedModels,
        {
          id: model.id,
          inference_endpoint_id: model.inference_endpoint_id,
          custom_api_group_name: undefined,
          display_name: model.display_name,
          reason: '必须声明唯一的推理 route',
          reason_kind: 'multiple_routes',
        },
      ];
    },
    /** 模拟连接被手工删掉：停用条目还引用它，但它已不在文件里。 */
    dropEndpoint(endpointId: string) {
      endpoints = endpoints.filter(endpoint => endpoint.id !== endpointId);
    },
    /** 模拟归属与目录失去一致：模型既不在运行目录、也不是停用条目，归属却还在。 */
    dropFromCatalogOnly(modelConfigId: string) {
      models = models.filter(candidate => candidate.id !== modelConfigId);
    },
  };
}
