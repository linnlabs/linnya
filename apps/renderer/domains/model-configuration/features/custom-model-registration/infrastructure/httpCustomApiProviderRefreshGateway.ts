import {
  CustomApiOnboardingErrorResponseSchema,
  CustomApiProviderRefreshResponseSchema,
} from '@app/schemas/custom-api-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type { CustomApiProviderRefreshGateway } from '../definitions/customApiProviderRefresh';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';

export const httpCustomApiProviderRefreshGateway: CustomApiProviderRefreshGateway = {
  async refreshProvider(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/custom-api-onboarding/providers/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = CustomApiOnboardingErrorResponseSchema.parse(payload);
      throw new CustomApiModelRegistrationError(failure.code, failure.message);
    }
    return CustomApiProviderRefreshResponseSchema.parse(payload);
  },
};
