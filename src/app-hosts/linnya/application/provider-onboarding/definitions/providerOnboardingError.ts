import {
  PROVIDER_ONBOARDING_ERROR_CODES,
  type ProviderOnboardingErrorCode,
} from '@app/schemas/provider-onboarding';

export { PROVIDER_ONBOARDING_ERROR_CODES, type ProviderOnboardingErrorCode };

export class ProviderOnboardingError extends Error {
  readonly code: ProviderOnboardingErrorCode;
  readonly statusCode: number;

  constructor(code: ProviderOnboardingErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'ProviderOnboardingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
