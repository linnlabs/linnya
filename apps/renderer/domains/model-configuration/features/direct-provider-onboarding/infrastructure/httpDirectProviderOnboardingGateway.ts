import {
  DirectProviderConnectionOnboardingResponseSchema,
  ProviderOnboardingErrorResponseSchema,
} from '@app/schemas/provider-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import { DirectProviderOnboardingError } from '../definitions/directProviderOnboardingError';
import type { DirectProviderOnboardingGateway } from '../definitions/directProviderOnboardingGateway';

export const httpDirectProviderOnboardingGateway: DirectProviderOnboardingGateway = {
  async connect(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/provider-onboarding/direct-providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = ProviderOnboardingErrorResponseSchema.parse(payload);
      throw new DirectProviderOnboardingError(failure.code, failure.message);
    }
    return DirectProviderConnectionOnboardingResponseSchema.parse(payload);
  },
};
