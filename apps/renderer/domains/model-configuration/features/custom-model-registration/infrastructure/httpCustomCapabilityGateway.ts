import {
  CustomApiModelRegistrationResponseSchema,
  CustomApiProviderUpdateResponseSchema,
  type CustomCapabilityProviderUpdateCommand,
  CustomApiOnboardingErrorResponseSchema,
  CustomCapabilityTestResultSchema,
  type CustomCapabilityModelRequest,
} from '@app/schemas/custom-api-onboarding';
import { apiFetch, getApiBaseUrl } from '@shared/services/localApiClient';
import { CustomApiModelRegistrationError } from '../definitions/customApiModelRegistrationError';

async function post(
  action: 'test' | 'models',
  request: CustomCapabilityModelRequest,
  signal: AbortSignal
): Promise<unknown> {
  const base = await getApiBaseUrl();
  const response = await apiFetch(`${base}/api/v1/custom-api-onboarding/capabilities/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = CustomApiOnboardingErrorResponseSchema.parse(payload);
    throw new CustomApiModelRegistrationError(failure.code, failure.message);
  }
  return payload;
}

export const httpCustomCapabilityGateway = {
  async updateProvider(request: CustomCapabilityProviderUpdateCommand) {
    const base = await getApiBaseUrl();
    const response = await apiFetch(`${base}/api/v1/custom-api-onboarding/capabilities/providers`, {
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
  async test(request: CustomCapabilityModelRequest, signal: AbortSignal) {
    return CustomCapabilityTestResultSchema.parse(await post('test', request, signal));
  },
  async register(request: CustomCapabilityModelRequest, signal: AbortSignal) {
    return CustomApiModelRegistrationResponseSchema.parse(await post('models', request, signal));
  },
};
