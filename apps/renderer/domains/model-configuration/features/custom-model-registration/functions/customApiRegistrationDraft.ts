import { type DiscoveredModel, type CustomApiModelRegistrationRequest } from '@app/schemas';
import type {
  CustomApiRegistrationDraft,
  CustomApiRegistrationSelection,
} from '../definitions/customApiRegistrationSession';

export function createCustomApiRegistrationDraft(): CustomApiRegistrationDraft {
  return {
    providerName: '',
    baseUrl: '',
    credentialSecret: '',
    customApiFormat: 'openai_compatible',
  };
}

/** Host 已通过唯一规则补齐能力并由网关校验；表单只投影选择项。 */
export function buildDiscoveredModelSelections(
  models: readonly DiscoveredModel[]
): CustomApiRegistrationSelection[] {
  return models.map(model => ({
    enabled: true,
    item: {
      endpoint_model_id: model.id,
      context_window_tokens: model.context_window_tokens,
      max_output_tokens: model.max_output_tokens,
      supports_image_input: model.supports_image_input,
      display_name: model.name,
    },
  }));
}

export function buildCustomApiRegistrationRequest(
  form: Readonly<CustomApiRegistrationDraft>,
  models: readonly CustomApiRegistrationSelection[]
): CustomApiModelRegistrationRequest {
  return {
    api_format: form.customApiFormat,
    base_url: form.baseUrl,
    ...(form.providerName.trim() ? { provider_name: form.providerName.trim() } : {}),
    ...(form.credentialSecret.trim() ? { api_key: form.credentialSecret.trim() } : {}),
    models: models.map(({ item, enabled }) => ({ ...item, picker_enabled: enabled })),
  };
}

export function setCustomApiModelSelection(
  models: readonly CustomApiRegistrationSelection[],
  modelId: string,
  enabled: boolean
): CustomApiRegistrationSelection[] {
  return models.map(row => (row.item.endpoint_model_id === modelId ? { ...row, enabled } : row));
}

export function setAllCustomApiModelSelections(
  models: readonly CustomApiRegistrationSelection[],
  enabled: boolean
): CustomApiRegistrationSelection[] {
  return models.map(row => ({ ...row, enabled }));
}
