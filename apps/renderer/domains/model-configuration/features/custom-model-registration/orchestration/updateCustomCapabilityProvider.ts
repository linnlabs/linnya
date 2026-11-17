import { CustomCapabilityProviderUpdateCommandSchema } from '@app/schemas/custom-api-onboarding';
import type {
  CustomApiProviderEditForm,
  CustomApiProviderEditResult,
} from '../definitions/customApiProviderEdit';
import { httpCustomCapabilityGateway } from '../infrastructure/httpCustomCapabilityGateway';

export async function updateCustomCapabilityProvider(
  currentName: string,
  form: CustomApiProviderEditForm
): Promise<CustomApiProviderEditResult> {
  if (!form.providerName.trim()) return { ok: false, issue: 'provider_name_required' };
  const parsed = CustomCapabilityProviderUpdateCommandSchema.safeParse({
    current_provider_name: currentName,
    provider_name: form.providerName,
    base_url: form.baseUrl,
    ...(form.credentialSecret.trim() ? { api_key: form.credentialSecret.trim() } : {}),
  });
  if (!parsed.success) return { ok: false, issue: 'base_url_invalid' };
  await httpCustomCapabilityGateway.updateProvider(parsed.data);
  return { ok: true };
}
