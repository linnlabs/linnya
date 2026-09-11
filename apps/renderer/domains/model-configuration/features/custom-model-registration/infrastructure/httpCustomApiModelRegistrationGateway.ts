import {
  CustomApiModelRegistrationResponseSchema,
  CustomApiOnboardingErrorResponseSchema,
  ModelDiscoveryResponseSchema,
  ModelDiscoveryErrorResponseSchema,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';
import type { CustomApiModelRegistrationGateway } from '../definitions/customApiModelRegistrationGateway';

export const httpCustomApiModelRegistrationGateway: CustomApiModelRegistrationGateway = {
  async register(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/custom-api-onboarding/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = CustomApiOnboardingErrorResponseSchema.parse(payload);
      throw new CustomApiModelRegistrationError(failure.code, failure.message);
    }
    return CustomApiModelRegistrationResponseSchema.parse(payload);
  },

  async discoverModels(request) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/custom-api-onboarding/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = ModelDiscoveryErrorResponseSchema.parse(payload);
      throw new CustomApiModelRegistrationError(failure.code, failure.message);
    }
    return ModelDiscoveryResponseSchema.parse(payload);
  },
};
