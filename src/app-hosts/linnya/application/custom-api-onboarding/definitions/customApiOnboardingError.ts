import type { CustomApiOnboardingErrorCode } from '@app/schemas/custom-api-onboarding';

export class CustomApiOnboardingError extends Error {
  readonly code: CustomApiOnboardingErrorCode;
  readonly statusCode: number;

  constructor(code: CustomApiOnboardingErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'CustomApiOnboardingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
