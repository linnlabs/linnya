import type { CustomApiProviderUpdateCommand } from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { buildCustomApiProviderModelUpdate } from './buildCustomApiProviderModelUpdate';
import { decideCustomApiProviderEndpoint } from './decideCustomApiProviderEndpoint';
import { selectCustomApiProviderModels } from './selectCustomApiProviderModels';
import { readCustomApiProviderName } from './readCustomApiProviderName';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

/** 分组归属、重名约束与连接替换决策只依赖本次读到的目录快照。 */
export function planCustomApiProviderUpdate(
  command: CustomApiProviderUpdateCommand,
  catalogModels: readonly ModelConfig[],
  endpoints: readonly InferenceEndpointView[],
  isFormalProviderModel: (modelId: string) => boolean,
  endpointResourceId: string
): { models: ModelConfig[]; endpoint: InferenceEndpointSelection } {
  const customModels = catalogModels.filter(
    model => model.catalog_source === 'user' && !isFormalProviderModel(model.id)
  );
  const groupModels = selectCustomApiProviderModels(
    command.current_provider_name,
    catalogModels,
    isFormalProviderModel
  );
  const groupModelIds = new Set(groupModels.map(model => model.id));
  if (
    command.provider_name !== command.current_provider_name &&
    customModels.some(
      model =>
        !groupModelIds.has(model.id) && readCustomApiProviderName(model) === command.provider_name
    )
  ) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_name_conflict',
      '已存在同名的自定义模型分组',
      409
    );
  }

  const groupEndpointIds = new Set(groupModels.map(model => model.inference_endpoint_id));
  const groupEndpoints = endpoints.filter(endpoint => groupEndpointIds.has(endpoint.id));
  if (
    groupEndpoints.length !== groupEndpointIds.size ||
    groupModels.some(model => !model.inference_route)
  ) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_configuration_invalid',
      '自定义模型分组引用的推理连接无效',
      500
    );
  }

  const binding = readCustomApiRuntimeBinding(command.api_format);
  const decision = decideCustomApiProviderEndpoint({
    groupModelIds,
    groupEndpoints,
    catalogModels,
    binding,
    baseUrl: command.base_url,
    hasNewSecret: command.api_key !== undefined,
  });

  let endpointId: string;
  let endpointSelection: InferenceEndpointSelection;
  switch (decision.kind) {
    case 'credential_required':
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.credential_required',
        '修改该分组的 API 地址或格式需要重新填写 API Key',
        400
      );
    case 'keep':
      endpointId = decision.endpoint.endpoint_id;
      endpointSelection = {
        kind: 'existing',
        inference_endpoint_id: decision.endpoint.id,
        ...(command.api_key ? { credential_secret: command.api_key } : {}),
      };
      break;
    case 'create_with_secret':
    case 'create_with_credential': {
      endpointId = `${binding.endpoint_id}:${endpointResourceId}`;
      endpointSelection = {
        kind: 'create',
        endpoint: {
          id: endpointResourceId,
          route_profile_id: binding.route_profile_id,
          endpoint_id: endpointId,
          base_url: command.base_url,
          auth_profile: binding.auth_profile,
          ...(decision.kind === 'create_with_credential'
            ? { credential_reference: decision.credential_reference }
            : { credential_secret: command.api_key }),
        },
      };
      break;
    }
  }

  const updatedModels: ModelConfig[] = groupModels.map(model =>
    buildCustomApiProviderModelUpdate({
      model,
      providerName: command.provider_name,
      baseUrl: command.base_url,
      endpointId,
      binding,
    })
  );
  return { models: updatedModels, endpoint: endpointSelection };
}
