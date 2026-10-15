import { readCustomApiFormatForRouteProfileId } from '@app/schemas/custom-api-onboarding';
import type { InferenceEndpointView, ModelConfig } from 'src/domains/model-catalog';

import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type { CustomApiProviderRefreshTarget } from '../definitions/customApiProviderRefreshTarget';
import { selectCustomApiProviderModels } from './selectCustomApiProviderModels';

/** 分组名称只是展示边界；同组的不同连接必须各自使用自己的协议、凭据与远端模型身份。 */
export function resolveCustomApiProviderRefreshTargets(
  providerName: string,
  models: readonly ModelConfig[],
  endpoints: readonly InferenceEndpointView[],
  isProviderModel: (modelId: string) => boolean
): CustomApiProviderRefreshTarget[] {
  const groupModels = selectCustomApiProviderModels(providerName, models, isProviderModel);

  const targets = new Map<string, CustomApiProviderRefreshTarget>();
  for (const model of groupModels) {
    const endpoint = endpoints.find(item => item.id === model.inference_endpoint_id);
    const apiFormat = endpoint && readCustomApiFormatForRouteProfileId(endpoint.route_profile_id);
    if (!endpoint || !apiFormat || !model.inference_route) {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.provider_configuration_invalid',
        '自定义模型分组引用的推理连接无效，请编辑连接后重试',
        400
      );
    }
    const previous = targets.get(endpoint.id);
    targets.set(endpoint.id, {
      endpoint,
      apiFormat,
      credentialModelId: previous?.credentialModelId ?? model.id,
      existingRemoteModelIds: new Set([
        ...(previous?.existingRemoteModelIds ?? []),
        model.inference_route.endpoint_model_id,
      ]),
    });
  }
  return [...targets.values()];
}
