import type { CustomApiOnboardingErrorCode, ModelDiscoveryErrorCode } from '@app/schemas';

export type CustomApiModelRegistrationErrorCode =
  | CustomApiOnboardingErrorCode
  | ModelDiscoveryErrorCode;

export class CustomApiModelRegistrationError extends Error {
  readonly code: CustomApiModelRegistrationErrorCode;

  constructor(code: CustomApiModelRegistrationErrorCode, message: string) {
    super(message);
    this.name = 'CustomApiModelRegistrationError';
    this.code = code;
  }
}
