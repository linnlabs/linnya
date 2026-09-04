import {
  normalizeCustomApiBaseUrl,
  type CustomApiModelRegistrationCommand,
} from '@app/schemas/custom-api-onboarding';

import type { ApiCustomModelForm } from '../definitions/customModelRegistrationForm';
import type { CustomModelRegistrationResult } from '../definitions/customModelRegistrationResult';
import type { CustomApiModelRegistrationGateway } from '../definitions/customApiModelRegistrationGateway';
import { httpCustomApiModelRegistrationGateway } from '../infrastructure/httpCustomApiModelRegistrationGateway';
import { parseModelTokenLimits } from '../../inference-endpoints';

export async function registerApiCustomModel(
  form: Readonly<ApiCustomModelForm>,
  gateway: CustomApiModelRegistrationGateway = httpCustomApiModelRegistrationGateway
): Promise<CustomModelRegistrationResult> {
  const endpointModelId = form.endpointModelId.trim();
  if (!endpointModelId) return { ok: false, issue: 'endpoint_model_id_required' };

  const tokenLimits = parseModelTokenLimits(form.contextWindowTokens, form.maxOutputTokens);
  if (!tokenLimits) return { ok: false, issue: 'token_limits_invalid' };

  const baseUrl = normalizeCustomApiBaseUrl(form.customApiFormat, form.baseUrl);
  if (!baseUrl) return { ok: false, issue: 'base_url_invalid' };

  const apiKey = form.credentialSecret.trim();
  const displayName = form.displayName.trim();
  const command: CustomApiModelRegistrationCommand = {
    api_format: form.customApiFormat,
    base_url: baseUrl,
    endpoint_model_id: endpointModelId,
    context_window_tokens: tokenLimits.contextWindowTokens,
    max_output_tokens: tokenLimits.maxOutputTokens,
    supports_image_input: form.supportsImageInput,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(displayName ? { display_name: displayName } : {}),
  };
  await gateway.register(command);
  return { ok: true };
}
