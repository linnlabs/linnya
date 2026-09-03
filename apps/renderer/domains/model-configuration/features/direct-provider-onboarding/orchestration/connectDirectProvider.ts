import type { DirectProviderOnboardingForm } from '../definitions/directProviderOnboardingForm';
import type { DirectProviderOnboardingGateway } from '../definitions/directProviderOnboardingGateway';
import type { DirectProviderOnboardingResult } from '../definitions/directProviderOnboardingForm';
import { httpDirectProviderOnboardingGateway } from '../infrastructure/httpDirectProviderOnboardingGateway';

export async function connectDirectProvider(
  form: Readonly<DirectProviderOnboardingForm>,
  gateway: DirectProviderOnboardingGateway = httpDirectProviderOnboardingGateway
): Promise<DirectProviderOnboardingResult> {
  const providerConnectionDefinitionId = form.providerConnectionDefinitionId.trim();
  if (!providerConnectionDefinitionId) return { ok: false, issue: 'provider_required' };
  const apiKey = form.apiKey.trim();
  if (!apiKey) return { ok: false, issue: 'api_key_required' };

  const response = await gateway.connect({
    provider_connection_definition_id: providerConnectionDefinitionId,
    api_key: apiKey,
  });
  return { ok: true, modelIds: response.model_ids };
}
