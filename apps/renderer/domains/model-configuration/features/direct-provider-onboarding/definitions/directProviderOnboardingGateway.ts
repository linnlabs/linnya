import type {
  DirectProviderConnectionOnboardingCommand,
  DirectProviderConnectionOnboardingResponse,
} from '@app/schemas/provider-onboarding';

export interface DirectProviderOnboardingGateway {
  connect(
    command: DirectProviderConnectionOnboardingCommand
  ): Promise<DirectProviderConnectionOnboardingResponse>;
}
