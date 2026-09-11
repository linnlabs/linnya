import {
  normalizeCustomApiBaseUrl,
  type CustomApiModelRegistrationRequest,
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
  const apiKey = form.credentialSecret?.trim() ?? '';
  const displayName = form.displayName?.trim() ?? '';
  const providerName = form.providerName?.trim() ?? '';

  // 若存在批量模型配置
  if (form.models && form.models.length > 0) {
    const baseUrl = normalizeCustomApiBaseUrl(form.customApiFormat, form.baseUrl);
    if (!baseUrl) return { ok: false, issue: 'base_url_invalid' };

    const command: CustomApiModelRegistrationRequest = {
      api_format: form.customApiFormat,
      base_url: baseUrl,
      ...(providerName ? { provider_name: providerName } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
      models: form.models,
    };
    await gateway.register(command);
    return { ok: true };
  }

  const endpointModelId = form.endpointModelId.trim();
  if (!endpointModelId) return { ok: false, issue: 'endpoint_model_id_required' };

  const tokenLimits = parseModelTokenLimits(
    form.contextWindowTokens || '256000',
    form.maxOutputTokens || '16384'
  );
  if (!tokenLimits) return { ok: false, issue: 'token_limits_invalid' };

  const baseUrl = normalizeCustomApiBaseUrl(form.customApiFormat, form.baseUrl);
  if (!baseUrl) return { ok: false, issue: 'base_url_invalid' };

  const command: CustomApiModelRegistrationRequest = {
    api_format: form.customApiFormat,
    base_url: baseUrl,
    endpoint_model_id: endpointModelId,
    context_window_tokens: tokenLimits.contextWindowTokens,
    max_output_tokens: tokenLimits.maxOutputTokens,
    supports_image_input: form.supportsImageInput,
    ...(providerName ? { provider_name: providerName } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(displayName ? { display_name: displayName } : {}),
  };
  await gateway.register(command);
  return { ok: true };
}
