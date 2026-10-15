import {
  CustomApiOnboardingErrorResponseSchema,
  CustomApiProviderUpdateResponseSchema,
} from '@app/schemas/custom-api-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import type { CustomApiProviderEditGateway } from '../definitions/customApiProviderEdit';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';

export const httpCustomApiProviderEditGateway: CustomApiProviderEditGateway = {
  async updateProvider(request) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/custom-api-onboarding/providers`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = CustomApiOnboardingErrorResponseSchema.parse(payload);
      throw new CustomApiModelRegistrationError(failure.code, failure.message);
    }
    return CustomApiProviderUpdateResponseSchema.parse(payload);
  },
};
