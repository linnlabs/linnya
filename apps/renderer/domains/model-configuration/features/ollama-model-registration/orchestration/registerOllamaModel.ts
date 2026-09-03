import type { OllamaModelRegistrationFormValues } from '../definitions/ollamaModelRegistrationForm';
import { normalizeOllamaServiceUrl } from '@app/schemas/ollama-onboarding';
import type { OllamaModelRegistrationGateway } from '../definitions/ollamaModelRegistrationGateway';
import type { OllamaModelRegistrationResult } from '../definitions/ollamaModelRegistrationResult';
import { parseModelTokenLimits } from '../../inference-endpoints';
import { httpOllamaModelRegistrationGateway } from '../infrastructure/httpOllamaModelRegistrationGateway';

export async function registerOllamaModel(
  providerConnectionDefinitionId: string,
  form: Readonly<OllamaModelRegistrationFormValues>,
  gateway: OllamaModelRegistrationGateway = httpOllamaModelRegistrationGateway
): Promise<OllamaModelRegistrationResult> {
  const endpointModelId = form.endpointModelId.trim();
  if (!endpointModelId) return { ok: false, issue: 'endpoint_model_id_required' };

  const tokenLimits = parseModelTokenLimits(form.contextWindowTokens, form.maxOutputTokens);
  if (!tokenLimits) return { ok: false, issue: 'token_limits_invalid' };
  const serviceUrl = normalizeOllamaServiceUrl(form.serviceUrl);
  if (!serviceUrl) return { ok: false, issue: 'service_url_invalid' };
  const displayName = form.displayName.trim();
  await gateway.register({
    provider_connection_definition_id: providerConnectionDefinitionId,
    service_url: serviceUrl,
    endpoint_model_id: endpointModelId,
    context_window_tokens: tokenLimits.contextWindowTokens,
    max_output_tokens: tokenLimits.maxOutputTokens,
    ...(displayName ? { display_name: displayName } : {}),
  });
  return { ok: true };
}
