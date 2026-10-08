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

/** 生成资产与实时资料查询共用准入规则；模型资料不授予新的运行协议。 */
export function projectModelsDevProviderModels(
  sourceProvider: ModelsDevProvider,
  policy: ProviderAdmissionPolicy
): ProviderModelDefinition[] {
  const sourceProviderId = sourceProvider.id;
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
