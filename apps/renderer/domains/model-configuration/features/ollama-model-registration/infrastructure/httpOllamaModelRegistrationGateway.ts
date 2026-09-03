import {
  OllamaModelRegistrationResponseSchema,
  OllamaOnboardingErrorResponseSchema,
} from '@app/schemas/ollama-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';

import {
  OllamaModelRegistrationError,
  type OllamaModelRegistrationGateway,
} from '../definitions/ollamaModelRegistrationGateway';

export const httpOllamaModelRegistrationGateway: OllamaModelRegistrationGateway = {
  async register(command) {
    const baseUrl = await getApiBaseUrl();
    const response = await apiFetch(`${baseUrl}/api/v1/ollama-onboarding/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const failure = OllamaOnboardingErrorResponseSchema.parse(payload);
      throw new OllamaModelRegistrationError(failure.code, failure.message);
    }
    return OllamaModelRegistrationResponseSchema.parse(payload);
  },
};
