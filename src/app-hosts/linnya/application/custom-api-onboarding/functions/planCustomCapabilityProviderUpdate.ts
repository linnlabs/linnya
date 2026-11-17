import {
  normalizeCustomCapabilityBaseUrl,
  readCustomCapabilityFormatForProfile,
  type CustomCapabilityProviderUpdateCommand,
} from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  ModelConfig,
  CustomApiGroup,
  InferenceEndpointView,
} from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { requireCustomApiGroup } from './requireCustomApiGroup';
import { decideCustomApiProviderEndpoint } from './decideCustomApiProviderEndpoint';

/** 连接编辑保持每个模型的能力和参数，只替换明确的地址、名称与凭据边界。 */
export function planCustomCapabilityProviderUpdate(
  command: CustomCapabilityProviderUpdateCommand,
  groups: readonly CustomApiGroup[],
  models: readonly ModelConfig[],
  endpoints: readonly InferenceEndpointView[],
  newEndpointId: string
): { models: ModelConfig[]; endpoint: InferenceEndpointSelection } {
  const group = requireCustomApiGroup(command.current_provider_name, groups);
  if (
    command.provider_name !== group.name &&
    groups.some(item => item.name === command.provider_name)
  ) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_name_conflict',
      '已存在同名连接',
      409
    );
  }
  const selected = endpoints.filter(item => group.inference_endpoint_ids.includes(item.id));
  const first = selected[0];
  const format = first && readCustomCapabilityFormatForProfile(first.route_profile_id);
  if (
    !first ||
    !format ||
    selected.length !== group.inference_endpoint_ids.length ||
    selected.some(item => item.route_profile_id !== first.route_profile_id)
  ) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.provider_configuration_invalid',
      '此分组包含不同接口，请分别管理连接',
      400
    );
  }
  if (!command.api_key && selected.some(item => item.auth_profile !== first.auth_profile)) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.credential_required',
      '此连接同时包含免密和鉴权模型，请填写统一的 API Key 后再保存',
      400
    );
  }
  const baseUrl = normalizeCustomCapabilityBaseUrl(format, command.base_url);
  if (!baseUrl)
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.invalid_command',
      'API 地址无效',
      400
    );
  const authProfile =
    command.api_key && first.auth_profile === 'none' ? 'bearer' : first.auth_profile;
  const groupModels = models.filter(
    model =>
      model.custom_provider_name === group.name &&
      model.inference_endpoint_id !== undefined &&
      group.inference_endpoint_ids.includes(model.inference_endpoint_id)
  );
  const decision = decideCustomApiProviderEndpoint({
    groupModelIds: new Set(groupModels.map(model => model.id)),
    groupEndpoints: selected,
    catalogEndpoints: endpoints,
    catalogModels: models,
    otherGroupEndpointIds: new Set(
      groups.filter(item => item.name !== group.name).flatMap(item => item.inference_endpoint_ids)
    ),
    binding: { ...first, auth_profile: authProfile },
    baseUrl,
    hasNewSecret: command.api_key !== undefined,
  });
  if (decision.kind === 'credential_required')
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.credential_required',
      '此连接包含不同凭据，请重新填写 API Key',
      400
    );
  const endpointResourceId = decision.kind === 'keep' ? decision.endpoint.id : newEndpointId;
  const endpointId =
    decision.kind === 'keep' ? decision.endpoint.endpoint_id : `custom:${endpointResourceId}`;
  const endpoint: InferenceEndpointSelection =
    decision.kind === 'keep'
      ? {
          kind: 'existing',
          inference_endpoint_id: endpointResourceId,
          ...(command.api_key ? { credential_secret: command.api_key } : {}),
        }
      : {
          kind: 'create',
          endpoint: {
            id: endpointResourceId,
            endpoint_id: endpointId,
            route_profile_id: first.route_profile_id,
            base_url: baseUrl,
            auth_profile: authProfile,
            ...(decision.kind === 'create_with_secret'
              ? { credential_secret: command.api_key }
              : { credential_reference: decision.credential_reference }),
          },
        };
  const updated: ModelConfig[] = groupModels.map(model => {
    const connection = { endpoint_id: endpointId, base_url: baseUrl };
    return {
      ...model,
      custom_provider_name: command.provider_name,
      ...(model.embedding_route
        ? {
            embedding_route: {
              ...model.embedding_route,
              ...connection,
              ...(command.api_key ? { auth_profile: 'bearer' as const } : {}),
            },
          }
        : {}),
      ...(model.reranking_route
        ? { reranking_route: { ...model.reranking_route, ...connection } }
        : {}),
      ...(model.image_generation_route
        ? {
            image_generation_route: {
              ...model.image_generation_route,
              ...connection,
              ...(command.api_key ? { auth_profile: 'bearer' as const } : {}),
            },
          }
        : {}),
      ...(model.document_ocr_route
        ? { document_ocr_route: { ...model.document_ocr_route, ...connection } }
        : {}),
    };
  });
  return { models: updated, endpoint };
}
