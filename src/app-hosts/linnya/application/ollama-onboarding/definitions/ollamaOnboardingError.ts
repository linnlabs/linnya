import type { OllamaOnboardingErrorCode } from '@app/schemas/ollama-onboarding';

export class OllamaOnboardingError extends Error {
  constructor(
    readonly code: OllamaOnboardingErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'OllamaOnboardingError';
  }
}
