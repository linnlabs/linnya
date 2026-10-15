import type { ProviderModelDefinition } from '../../../definitions/providerCatalog';
import type { ModelsDevModel, ModelsDevProvider } from '../definitions/modelsDevSource';
import type { ProviderAdmissionPolicy } from '../definitions/providerAdmissionPolicy';

function projectModel(model: ModelsDevModel): ProviderModelDefinition | undefined {
  if (model.status === 'deprecated') return undefined;
  if (model.modalities?.output && !model.modalities.output.includes('text')) return undefined;
  if (model.limit.context === 0 || model.limit.output === 0) return undefined;

  const maxInputTokens = Math.min(model.limit.input ?? model.limit.context, model.limit.context);
  return {
    id: model.id,
    display_name: model.name,
    // alpha 与 beta 都是上游预发布事实，不能在产品目录中被提升为正式模型。
    release_status: model.status === 'alpha' || model.status === 'beta' ? 'preview' : 'active',
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

function readSourceModels(sourceProvider: ModelsDevProvider): ModelsDevModel[] {
  const sourceProviderId = sourceProvider.id;
  const modelIds = new Set<string>();
  return Object.entries(sourceProvider.models).map(([sourceModelId, model]) => {
    if (model.id !== sourceModelId) {
      throw new Error(
        `models.dev Model key/id 不一致: provider=${sourceProviderId}, key=${sourceModelId}, id=${model.id}`
      );
    }
    if (modelIds.has(model.id)) {
      throw new Error(`models.dev Provider 存在重复模型 ID: ${sourceProviderId}/${model.id}`);
    }
    modelIds.add(model.id);
    return model;
  });
}

function projectModelMetadata(
  models: readonly ModelsDevModel[],
  sourceProviderId: string,
  policy: ProviderAdmissionPolicy
): ProviderModelDefinition[] {
  return models
    .map(model => {
      if (policy.model_admission?.excluded_model_ids?.includes(model.id)) return undefined;
      const projectedModel = projectModel(model);
      if (!projectedModel) return undefined;
      // 上游覆盖只触发人工审查；不能根据 npm/api/shape 自动选择 Linnya 的运行协议。
      if (
        policy.model_admission?.requires_provider_override_review &&
        model.provider &&
        !policy.runtime_binding?.model_route_bindings?.some(
          binding => binding.model_id === model.id
        )
      ) {
        throw new Error(
          `Provider ${sourceProviderId} 的模型 provider 覆盖缺少已审查 route: ${model.id}`
        );
      }
      return projectedModel;
    })
    .filter((model): model is ProviderModelDefinition => model !== undefined)
    .sort(
      (left, right) =>
        left.display_name.localeCompare(right.display_name) || left.id.localeCompare(right.id)
    );
}

/** 发布目录依据上游工具能力准入，不能把资料查询的宽度扩散到静态候选。 */
export function projectModelsDevProviderModels(
  sourceProvider: ModelsDevProvider,
  policy: ProviderAdmissionPolicy
): ProviderModelDefinition[] {
  const admittedModels = readSourceModels(sourceProvider).filter(
    model => !policy.model_admission?.requires_tool_call || model.tool_call === true
  );
  return projectModelMetadata(admittedModels, sourceProvider.id, policy);
}

/**
 * 资料查询不以 models.dev 的工具标记否决官方已确认的能力；Host 只按精确 ID 补充缺失资料。
 * 返回的能力仍是来源观察值，不能覆盖官方能力；模型级协议覆盖继续接受相同的 route 审查。
 */
export function projectModelsDevProviderMetadata(
  sourceProvider: ModelsDevProvider,
  policy: ProviderAdmissionPolicy
): ProviderModelDefinition[] {
  return projectModelMetadata(readSourceModels(sourceProvider), sourceProvider.id, policy);
}
