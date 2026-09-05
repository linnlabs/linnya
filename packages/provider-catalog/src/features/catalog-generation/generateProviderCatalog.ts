import type {
  ProviderCatalogGeneration,
  ProviderCatalogSnapshot,
  ProviderConnectionDefinition,
  ProviderDefinition,
  ProviderModelDefinition,
} from '../../definitions/providerCatalog';
import type {
  ProviderRuntimeBinding,
  ProviderRuntimeBindingSnapshot,
} from '../../definitions/providerRuntimeBinding';
import type {
  ModelsDevModel,
  ModelsDevSource,
} from '../catalog-admission/definitions/modelsDevSource';
import type { ProviderAdmissionPolicy } from '../catalog-admission/definitions/providerAdmissionPolicy';
import { PROVIDER_ADMISSION_POLICIES } from '../catalog-admission/registry/providerAdmissionPolicies';

export const PROVIDER_CATALOG_POLICY_VERSION = 15;
export const MODELS_DEV_SOURCE_URL = 'https://models.dev/api.json';

export interface GeneratedProviderCatalogProjections {
  readonly publicCatalog: ProviderCatalogSnapshot;
  readonly runtimeBindings: ProviderRuntimeBindingSnapshot;
}

interface MutableProviderProjection {
  readonly id: string;
  readonly display_name: string;
  readonly connections: ProviderConnectionDefinition[];
}

function projectModel(model: ModelsDevModel): ProviderModelDefinition | undefined {
  if (model.status === 'deprecated') return undefined;
  if (model.modalities?.output && !model.modalities.output.includes('text')) return undefined;
  if (model.limit.context === 0 || model.limit.output === 0) return undefined;

  const maxInputTokens = Math.min(model.limit.input ?? model.limit.context, model.limit.context);
  return {
    id: model.id,
    display_name: model.name,
    release_status: model.status === 'beta' ? 'preview' : 'active',
    context_window_tokens: model.limit.context,
    max_input_tokens: maxInputTokens,
    max_output_tokens: model.limit.output,
    capabilities: {
      image_input: model.modalities?.input?.includes('image') ?? false,
      tool_call: model.tool_call ?? false,
      reasoning: model.reasoning ?? false,
    },
    ...(model.family ? { family: model.family } : {}),
    ...(model.release_date ? { release_date: model.release_date } : {}),
  };
}

function readSourceProvider(source: ModelsDevSource, sourceProviderId: string) {
  const provider = source[sourceProviderId];
  if (!provider) throw new Error(`models.dev 缺少已准入 Provider: ${sourceProviderId}`);
  if (provider.id !== sourceProviderId) {
    throw new Error(
      `models.dev Provider key/id 不一致: key=${sourceProviderId}, id=${provider.id}`
    );
  }
  if (provider.api) {
    let parsedApiUrl: URL;
    try {
      parsedApiUrl = new URL(provider.api);
    } catch {
      throw new Error(`models.dev Provider API URL 非法: ${sourceProviderId}`);
    }
    if (parsedApiUrl.protocol !== 'https:' && parsedApiUrl.protocol !== 'http:') {
      throw new Error(`models.dev Provider API 不是 HTTP(S): ${sourceProviderId}`);
    }
  }
  return provider;
}

function projectBundledModels(source: ModelsDevSource, policy: ProviderAdmissionPolicy) {
  if (policy.source_provider_id && policy.bundled_models) {
    throw new Error(
      `Provider 不得同时声明 models.dev 与内置模型来源: ${policy.provider_definition_id}`
    );
  }
  if (policy.bundled_models) {
    return [...policy.bundled_models].sort(
      (left, right) =>
        left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id)
    );
  }
  const sourceProviderId = policy.source_provider_id;
  if (!sourceProviderId) return [];
  const sourceProvider = readSourceProvider(source, sourceProviderId);
  const modelIds = new Set<string>();

  return Object.entries(sourceProvider.models)
    .map(([sourceModelId, model]) => {
      if (model.id !== sourceModelId) {
        throw new Error(
          `models.dev Model key/id 不一致: provider=${sourceProviderId}, key=${sourceModelId}, id=${model.id}`
        );
      }
      if (modelIds.has(model.id)) {
        throw new Error(`models.dev Provider 存在重复模型 ID: ${sourceProviderId}/${model.id}`);
      }
      modelIds.add(model.id);
      if (policy.model_admission?.requires_tool_call && model.tool_call !== true) {
        return undefined;
      }
      return projectModel(model);
    })
    .filter((model): model is ProviderModelDefinition => model !== undefined)
    .sort(
      (left, right) =>
        left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id)
    );
}

export function generateProviderCatalog(
  source: ModelsDevSource,
  generation: ProviderCatalogGeneration
): GeneratedProviderCatalogProjections {
  const connectionIds = new Set<string>();
  const providersById = new Map<string, MutableProviderProjection>();
  const bindings: ProviderRuntimeBinding[] = [];

  for (const policy of PROVIDER_ADMISSION_POLICIES) {
    const connectionDefinitionId =
      policy.provider_connection_definition_id ?? policy.provider_definition_id;
    if (connectionIds.has(connectionDefinitionId)) {
      throw new Error(
        `Provider admission policy 存在重复 connection ID: ${connectionDefinitionId}`
      );
    }
    connectionIds.add(connectionDefinitionId);

    const existingProvider = providersById.get(policy.provider_definition_id);
    if (existingProvider && existingProvider.display_name !== policy.display_name) {
      throw new Error(`同一 Provider 品牌存在冲突显示名: ${policy.provider_definition_id}`);
    }
    const provider =
      existingProvider ??
      ({
        id: policy.provider_definition_id,
        display_name: policy.display_name,
        connections: [],
      } satisfies MutableProviderProjection);
    if (!existingProvider) {
      providersById.set(policy.provider_definition_id, provider);
    }

    const models = projectBundledModels(source, policy);
    if (policy.model_discovery === 'bundled' && models.length === 0) {
      throw new Error(`bundled Provider 缺少模型来源: ${policy.provider_definition_id}`);
    }
    if (policy.model_discovery !== 'bundled' && models.length !== 0) {
      throw new Error(`动态发现 Provider 不得声明内置模型: ${policy.provider_definition_id}`);
    }
    if (policy.runtime_binding?.model_route_bindings) {
      const admittedModelIds = new Set(models.map(model => model.id));
      const boundModelIds = new Set<string>();
      const supportedProfileIds = new Set(policy.runtime_binding.supported_route_profile_ids);
      for (const modelBinding of policy.runtime_binding.model_route_bindings) {
        if (!admittedModelIds.has(modelBinding.model_id)) {
          throw new Error(
            `Provider ${policy.provider_definition_id} 的模型 route 未进入公开目录: ${modelBinding.model_id}`
          );
        }
        if (boundModelIds.has(modelBinding.model_id)) {
          throw new Error(
            `Provider ${policy.provider_definition_id} 包含重复模型 route: ${modelBinding.model_id}`
          );
        }
        if (!supportedProfileIds.has(modelBinding.route_profile_id)) {
          throw new Error(
            `Provider ${policy.provider_definition_id} 的模型 route 未声明支持: ${modelBinding.route_profile_id}`
          );
        }
        boundModelIds.add(modelBinding.model_id);
      }
    }

    provider.connections.push({
      id: connectionDefinitionId,
      display_name: policy.connection_display_name ?? policy.display_name,
      ...(policy.connection_description ? { description: policy.connection_description } : {}),
      ...(policy.connection_badge ? { badge: policy.connection_badge } : {}),
      ...(policy.setup_help_url ? { setup_help_url: policy.setup_help_url } : {}),
      kind: policy.kind,
      release_status: policy.release_status,
      setup_fields: [...policy.setup_fields],
      model_discovery: policy.model_discovery,
      models,
    });

    if (policy.runtime_binding) {
      const sourceProvider = policy.source_provider_id
        ? readSourceProvider(source, policy.source_provider_id)
        : undefined;
      const sourceCatalogObservation = sourceProvider
        ? {
            package_name: sourceProvider.npm,
            ...(sourceProvider.api ? { api_url: sourceProvider.api } : {}),
          }
        : policy.source_catalog_observation;
      if (!sourceCatalogObservation) {
        throw new Error(`runtime binding 缺少来源观察值: ${policy.provider_definition_id}`);
      }
      bindings.push({
        provider_definition_id: policy.provider_definition_id,
        provider_connection_definition_id: connectionDefinitionId,
        ...policy.runtime_binding,
        source_catalog_observation: sourceCatalogObservation,
      });
    }
  }

  return {
    publicCatalog: {
      schema_version: 2,
      generation,
      providers: [...providersById.values()] satisfies ProviderDefinition[],
    },
    runtimeBindings: {
      schema_version: 2,
      generation_id: generation.id,
      source_sha256: generation.source_sha256,
      bindings,
    },
  };
}
