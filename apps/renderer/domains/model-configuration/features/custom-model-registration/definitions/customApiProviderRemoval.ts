import type {
  CustomApiProviderRemovalCommand,
  CustomApiProviderRemovalResponse,
} from '@app/schemas/custom-api-onboarding';
export interface CustomApiProviderRemovalGateway {
  removeProvider(
    command: CustomApiProviderRemovalCommand
  ): Promise<CustomApiProviderRemovalResponse>;
}
