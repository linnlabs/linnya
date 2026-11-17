import {
  CUSTOM_CAPABILITY_API_FORMATS,
  type CustomCapabilityModelRequest,
} from '@app/schemas/custom-api-onboarding';
import type { CustomCapabilityDraft } from '../definitions/customCapabilityRegistration';

export function buildCustomCapabilityRequest(
  form: Readonly<CustomCapabilityDraft>
): CustomCapabilityModelRequest {
  const kind = CUSTOM_CAPABILITY_API_FORMATS.find(item => item.id === form.apiFormat)?.kind;
  return {
    api_format: form.apiFormat,
    provider_name: form.providerName,
    base_url: form.baseUrl,
    endpoint_model_id: form.modelId,
    ...(form.credentialSecret.trim() ? { api_key: form.credentialSecret.trim() } : {}),
    ...(form.displayName.trim() ? { display_name: form.displayName.trim() } : {}),
    ...(kind === 'document_ocr' ? { ocr_mode: form.ocrMode } : {}),
    ...(kind === 'image_generation' && form.imageSizes.trim()
      ? { image_sizes: form.imageSizes.split(/[,，]/).map(item => item.trim()) }
      : {}),
  };
}
