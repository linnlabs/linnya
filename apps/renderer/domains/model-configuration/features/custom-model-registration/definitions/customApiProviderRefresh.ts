import type {
  CustomApiProviderRefreshCommand,
  CustomApiProviderRefreshResponse,
} from '@app/schemas/custom-api-onboarding';

export interface CustomApiProviderRefreshGateway {
  refreshProvider(
    command: CustomApiProviderRefreshCommand
  ): Promise<CustomApiProviderRefreshResponse>;
}
