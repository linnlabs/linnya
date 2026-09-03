import type {
  OllamaModelRegistrationCommand,
  OllamaModelRegistrationResponse,
  OllamaOnboardingErrorCode,
} from '@app/schemas/ollama-onboarding';

export interface OllamaModelRegistrationGateway {
  register(command: OllamaModelRegistrationCommand): Promise<OllamaModelRegistrationResponse>;
}

export class OllamaModelRegistrationError extends Error {
  constructor(
    readonly code: OllamaOnboardingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OllamaModelRegistrationError';
  }
}

export interface OllamaModelDiscoveryPort {
  listModels(serviceUrl: string): Promise<readonly string[]>;
}
