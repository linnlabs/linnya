import {
  CustomApiOnboardingErrorResponseSchema,
  CustomApiProviderRemovalResponseSchema,
} from '@app/schemas/custom-api-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type { CustomApiProviderRemovalGateway } from '../definitions/customApiProviderRemoval';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';

export const httpCustomApiProviderRemovalGateway: CustomApiProviderRemovalGateway = {
  async removeProvider(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/custom-api-onboarding/providers`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = CustomApiOnboardingErrorResponseSchema.parse(payload);
      throw new CustomApiModelRegistrationError(failure.code, failure.message);
    }
    return CustomApiProviderRemovalResponseSchema.parse(payload);
  },
};
