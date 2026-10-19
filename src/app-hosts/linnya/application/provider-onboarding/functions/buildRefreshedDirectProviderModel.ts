import { isDeepStrictEqual } from 'node:util';

import type { ResolvedProviderOnboardingModelRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';
import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';
import type { ProviderModelDefinition } from '@linnya/provider-catalog';

import { buildDirectProviderModelRegistration } from './buildDirectProviderModelRegistration';

export interface BuildRefreshedDirectProviderModelInput {
  readonly existingModel: ModelConfig;
  readonly providerModel: ProviderModelDefinition;
  readonly binding: ResolvedProviderOnboardingModelRuntimeBinding;
  readonly endpoint: InferenceEndpointView;
}

/** 只刷新正式 Provider 拥有的模型事实，保留本地身份、可见性和其他独立配置。 */
export function buildRefreshedDirectProviderModel(
  input: BuildRefreshedDirectProviderModelInput
): ModelConfig | undefined {
  const plan = buildDirectProviderModelRegistration({
    modelId: input.existingModel.id,
    endpointResourceId: input.endpoint.id,
    providerModel: input.providerModel,
    // 刷新只更新模型资料；已保存的连接拥有 URL、认证和协议，目录更新不能隐式迁移它。
    binding: {
      ...input.binding,
      base_url: input.endpoint.base_url,
      auth_profile: input.endpoint.auth_profile,
      route_profile_id: input.endpoint.route_profile_id,
    },
    reusableEndpoint: input.endpoint,
  });
  const refreshedModel: ModelConfig = {
    ...input.existingModel,
    model_name: plan.model.model_name,
    capabilities: plan.model.capabilities,
    display_name: plan.model.display_name,
    inference_route: plan.model.inference_route,
  };
  const changed =
    input.existingModel.model_name !== refreshedModel.model_name ||
    input.existingModel.display_name !== refreshedModel.display_name ||
    !isDeepStrictEqual(input.existingModel.capabilities, refreshedModel.capabilities) ||
    !isDeepStrictEqual(input.existingModel.inference_route, refreshedModel.inference_route);
  return changed ? refreshedModel : undefined;
}
