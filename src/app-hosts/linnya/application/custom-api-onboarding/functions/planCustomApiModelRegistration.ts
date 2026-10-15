import type { CustomApiModelRegistrationCommand } from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  UserModelRegistration,
} from 'src/domains/model-catalog';
import type { ModelPickerModelPreference } from 'src/domains/model-picker-preferences';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { buildCustomApiModelRegistration } from './buildCustomApiModelRegistration';
import { findReusableCustomApiEndpoint } from './findReusableCustomApiEndpoint';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

/** 连接复用、批内共享和显式选择在同一份纯计划中决定，执行层不逐项提交。 */
export function planCustomApiModelRegistration(
  command: CustomApiModelRegistrationCommand,
  endpoints: readonly InferenceEndpointView[],
  identities: { readonly modelIds: readonly string[]; readonly endpointResourceId: string }
): { registrations: UserModelRegistration[]; preferences: ModelPickerModelPreference[] } {
  const binding = readCustomApiRuntimeBinding(command.api_format);
  const reusable = command.api_key
    ? undefined
    : findReusableCustomApiEndpoint(endpoints, binding, command.base_url);
  if (!reusable && !command.api_key) {
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.credential_required',
      '没有唯一可复用的连接，请填写 API Key',
      400
    );
  }
  const resourceId = reusable?.id ?? identities.endpointResourceId;
  const endpointId = reusable?.endpoint_id ?? `${binding.endpoint_id}:${resourceId}`;
  const registrations = command.models.map((item, index) => {
    const endpoint: InferenceEndpointSelection =
      reusable || index > 0
        ? { kind: 'existing', inference_endpoint_id: resourceId }
        : {
            kind: 'create',
            endpoint: {
              id: resourceId,
              route_profile_id: binding.route_profile_id,
              endpoint_id: endpointId,
              base_url: command.base_url,
              auth_profile: binding.auth_profile,
              credential_secret: command.api_key,
            },
          };
    return {
      model: buildCustomApiModelRegistration({
        modelId: identities.modelIds[index],
        endpointId,
        command,
        model: item,
        binding,
      }),
      endpoint,
    };
  });
  const preferences = command.models.flatMap((item, index) =>
    item.picker_enabled === undefined
      ? []
      : [{ model_config_id: registrations[index].model.id, visible: item.picker_enabled }]
  );
  return { registrations, preferences };
}
