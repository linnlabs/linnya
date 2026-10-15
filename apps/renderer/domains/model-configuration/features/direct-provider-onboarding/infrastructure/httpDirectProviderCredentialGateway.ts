import { ProviderOnboardingErrorResponseSchema } from '@app/schemas/provider-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type { DirectProviderCredentialGateway } from '../definitions/directProviderCredentialReplacement';
import { DirectProviderOnboardingError } from '../definitions/directProviderOnboardingError';

export const httpDirectProviderCredentialGateway: DirectProviderCredentialGateway = {
  async replaceCredential(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(
      `${baseUrl}/api/v1/provider-onboarding/direct-providers/credential`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      }
    );
    if (response.ok) return;
    const failure = ProviderOnboardingErrorResponseSchema.parse(await response.json());
    throw new DirectProviderOnboardingError(failure.code, failure.message);
  },
};
