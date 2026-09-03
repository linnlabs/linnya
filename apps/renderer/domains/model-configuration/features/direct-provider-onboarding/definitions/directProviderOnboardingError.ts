import type { ProviderOnboardingErrorCode } from '@app/schemas/provider-onboarding';

export class DirectProviderOnboardingError extends Error {
  readonly code: ProviderOnboardingErrorCode;

  constructor(code: ProviderOnboardingErrorCode, message: string) {
    super(message);
    this.name = 'DirectProviderOnboardingError';
    this.code = code;
  }
}
