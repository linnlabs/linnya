import type { CustomApiOnboardingErrorCode } from '@app/schemas/custom-api-onboarding';

export class CustomApiModelRegistrationError extends Error {
  readonly code: CustomApiOnboardingErrorCode;

  constructor(code: CustomApiOnboardingErrorCode, message: string) {
    super(message);
    this.name = 'CustomApiModelRegistrationError';
    this.code = code;
  }
}
